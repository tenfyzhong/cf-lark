import { safeError, ServiceError } from '../domain/errors';
import type { JsonObject } from '../domain/models';
import type { DocumentProfile } from '../ports/document-parser';

export interface PureEngine {
    toIMMarkdown?(content: string, docInput: string): Promise<string>;
    parse?(xml: string): Promise<DocumentProfile>;
    formatEvent?(content: string, mentions: unknown[]): Promise<string>;
    format?(content: string, mentions: unknown[]): Promise<string>;
    process?(input: JsonObject): Promise<unknown>;
    processMail?(input: JsonObject): Promise<unknown>;
}
const limit = 40 * 1024 * 1024;
export async function pureEngineResponse(request: Request, engine: PureEngine): Promise<Response> {
    try {
        if (request.method !== 'POST') throw new ServiceError('INVALID_ARGUMENTS', 'Only POST is supported.');
        if (!request.body || Number(request.headers.get('Content-Length') ?? 0) > limit) throw new ServiceError('INVALID_ARGUMENTS', 'The engine request exceeds its size limit.');
        let size = 0;
        const limited = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
            size += chunk.byteLength;
            if (size > limit) throw new ServiceError('INVALID_ARGUMENTS', 'The engine request exceeds its size limit.');
            controller.enqueue(chunk);
        } }));
        let input: { operation?: string; args?: unknown[] };
        try { input = await new Response(limited).json(); } catch (error) {
            if (error instanceof ServiceError) throw error;
            throw new ServiceError('INVALID_ARGUMENTS', 'A valid engine request is required.');
        }
        const operation = input?.operation;
        const args = input?.args;
        if (!['parse', 'format', 'process', 'processMail', 'toIMMarkdown', 'formatEvent'].includes(String(operation)) || !Array.isArray(args)) throw new ServiceError('INVALID_ARGUMENTS', 'Unknown pure operation.');
        const method = engine[operation as keyof PureEngine];
        const object = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);
        if ((operation === 'parse' && (args.length !== 1 || typeof args[0] !== 'string'))
            || (operation === 'toIMMarkdown' && (args.length !== 2 || typeof args[0] !== 'string' || typeof args[1] !== 'string'))
            || (['format', 'formatEvent'].includes(String(operation)) && (args.length !== 2 || typeof args[0] !== 'string' || !Array.isArray(args[1])))
            || (['process', 'processMail'].includes(String(operation)) && (args.length !== 1 || !object(args[0])))) throw new ServiceError('INVALID_ARGUMENTS', 'Invalid pure operation arguments.');
        if (!method) throw new ServiceError('ENGINE_OPERATION_UNAVAILABLE', 'This engine does not provide the operation.', 503);
        const result = operation === 'formatEvent' ? await engine.formatEvent!(args[0] as string, args[1] as unknown[]) : operation === 'toIMMarkdown' ? await engine.toIMMarkdown!(args[0] as string, args[1] as string) : operation === 'parse' ? await engine.parse!(args[0] as string)
            : operation === 'format' ? await engine.format!(args[0] as string, args[1] as unknown[])
                : operation === 'process' ? await engine.process!(args[0] as JsonObject) : await engine.processMail!(args[0] as JsonObject);
        return Response.json({ result });
    } catch (error) {
        return Response.json(safeError(error), { status: error instanceof ServiceError ? error.status : 500 });
    }
}

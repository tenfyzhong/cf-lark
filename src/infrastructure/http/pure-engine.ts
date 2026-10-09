import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { DocumentParser, DocumentProfile } from '../../ports/document-parser';
import type { MailTransformer } from '../../ports/mail';

export class RemotePureEngine implements DocumentParser, MailTransformer {
    constructor(private readonly binding?: { fetch(request: Request): Promise<Response> }) {}
    private async call(operation: string, args: unknown[]): Promise<unknown> {
        if (!this.binding) throw new ServiceError('ENGINE_UNAVAILABLE', 'The private transformation service is not configured.', 503);
        let response: Response;
        try { response = await this.binding.fetch(new Request('https://pure-engine.internal/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, args }) })); }
        catch { throw new ServiceError('ENGINE_UNAVAILABLE', 'The private transformation service could not be reached.', 503); }
        const value = await response.json() as { result?: unknown; error?: { code?: string; message?: string }; code?: string; message?: string };
        if (!response.ok) {
            const error = value.error ?? value;
            throw new ServiceError(error.code ?? 'ENGINE_ERROR', error.message ?? 'The pure operation failed.', response.status);
        }
        return value.result;
    }
    async toIMMarkdown(content: string, docInput: string): Promise<string> { return await this.call('toIMMarkdown', [content, docInput]) as string; }
    async parse(xml: string): Promise<DocumentProfile> { return await this.call('parse', [xml]) as DocumentProfile; }
    async formatEvent(content: string, mentions: unknown[]): Promise<string> { return await this.call('formatEvent', [content, mentions]) as string; }
    async format(content: string, mentions: unknown[]): Promise<string> { return await this.call('format', [content, mentions]) as string; }
    process(input: JsonObject) { return this.call('process', [input]); }
    processMail(input: JsonObject) { return this.call('processMail', [input]); }
}

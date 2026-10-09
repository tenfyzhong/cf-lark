import { ServiceError } from '../../domain/errors';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { Encryption } from '../../ports/credentials';
import { jsonChunks, jsonSize, MAX_WORKFLOW_BYTES, WorkflowJsonParser } from './workflow-json';
export interface WorkflowBlobReference { id: string; owner: string; nonce: string; size: number; bytes: number }
const encoder = new TextEncoder();
const context = (owner: string, id: string, nonce: string, index: number) => `workflow-blob:${owner}:${id}:${nonce}:${index}`;
export class EncryptedWorkflowBlobs {
    constructor(private readonly artifacts: ArtifactFiles, private readonly encryption: Encryption) {}
    async write(owner: string, id: string, value: unknown): Promise<WorkflowBlobReference> {
        const bytes = jsonSize(value), nonce = crypto.randomUUID(), internalOwner = `workflow-internal:${crypto.randomUUID()}`;
        if (!this.artifacts.ingest) throw new ServiceError('WORKFLOW_STORAGE_UNAVAILABLE', 'Streaming internal workflow storage is unavailable.', 503);
        const encryption = this.encryption;
        async function* lines() {
            let buffer = '', index = 0;
            for (const part of jsonChunks(value)) {
                buffer += part;
                if (buffer.length >= 32768) { yield encoder.encode(`${await encryption.encrypt(context(owner, id, nonce, index++), JSON.stringify({ chunk: buffer }))}\n`); buffer = ''; }
            }
            if (buffer) yield encoder.encode(`${await encryption.encrypt(context(owner, id, nonce, index++), JSON.stringify({ chunk: buffer }))}\n`);
            yield encoder.encode(`${await encryption.encrypt(context(owner, id, nonce, index), JSON.stringify({ end: true, chunks: index, bytes }))}\n`);
        }
        const iterator = lines(), body = new ReadableStream<Uint8Array>({ async pull(controller) { try { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(next.value); } catch (error) { controller.error(error); } }, async cancel() { await iterator.return(undefined); } });
        const artifact = await this.artifacts.ingest(internalOwner, Math.min(2_000_000_000, bytes * 9 + 65536), body);
        return { id: artifact.id, owner: internalOwner, nonce, size: artifact.size, bytes };
    }
    async read(owner: string, id: string, reference: WorkflowBlobReference): Promise<unknown> {
        if (!reference.owner.startsWith('workflow-internal:') || reference.bytes > MAX_WORKFLOW_BYTES || reference.bytes < 0) throw new ServiceError('INVALID_WORKFLOW_BLOB', 'Invalid internal workflow reference.', 500);
        const response = await this.artifacts.read(reference.owner, reference.id);
        if (!response.body) throw new ServiceError('INVALID_WORKFLOW_BLOB', 'Workflow blob body is missing.', 500);
        const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }), parser = new WorkflowJsonParser();
        let buffer = '', index = 0, bytes = 0, encoded = 0, ended = false;
        try {
            while (true) {
                const next = await reader.read();
                if (next.done) break;
                encoded += next.value.length; if (encoded > reference.size) throw new ServiceError('INVALID_WORKFLOW_BLOB', 'Workflow blob size changed.', 500);
                buffer += decoder.decode(next.value, { stream: true });
                let newline: number;
                while ((newline = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
                    if (ended || line.length > 1024 * 1024 || !line) throw new ServiceError('INVALID_WORKFLOW_BLOB', 'Workflow blob framing is invalid.', 500);
                    let decoded: { chunk?: unknown; end?: unknown; chunks?: unknown; bytes?: unknown };
                    try { decoded = JSON.parse(await this.encryption.decrypt(context(owner, id, reference.nonce, index), line)); } catch { throw new ServiceError('INVALID_WORKFLOW_BLOB', 'Workflow blob authentication failed.', 500); }
                    if (decoded.end === true) { if (decoded.chunks !== index || decoded.bytes !== bytes || bytes !== reference.bytes) throw new ServiceError('INVALID_WORKFLOW_BLOB', 'Workflow blob completion marker is invalid.', 500); ended = true; }
                    else { if (typeof decoded.chunk !== 'string') throw new ServiceError('INVALID_WORKFLOW_BLOB', 'Workflow blob chunk is invalid.', 500); bytes += encoder.encode(decoded.chunk).length; parser.push(decoded.chunk); index++; }
                }
                if (buffer.length > 1024 * 1024) throw new ServiceError('INVALID_WORKFLOW_BLOB', 'Workflow blob framing exceeds its bound.', 500);
            }
            buffer += decoder.decode();
            if (!ended || buffer || encoded !== reference.size) throw new ServiceError('INVALID_WORKFLOW_BLOB', 'Workflow blob is truncated.', 500);
            return parser.finish();
        } finally { await reader.cancel(); }
    }
    async remove(reference: WorkflowBlobReference) {
        try { await this.artifacts.remove(reference.owner, reference.id); }
        catch (error) { if (!(error instanceof ServiceError) || error.code !== 'ARTIFACT_NOT_FOUND') throw error; }
    }
}

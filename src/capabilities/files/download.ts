import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { ArtifactStore } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';

export async function saveDownloadResponse(artifacts: ArtifactStore, context: CommandContext, response: Response, name: string) {
    authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
    if (!response.ok || (!response.body && response.headers.get('Content-Length') !== '0')) throw new ServiceError('INVALID_DOWNLOAD', 'The download response has no successful body.', 502);
    const body = response.body ?? new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    const length = response.headers.get('Content-Length'); let artifact;
    if (length !== null) {
        const size = Number(length);
        if (!Number.isSafeInteger(size) || size < 0) throw new ServiceError('INVALID_SIZE', 'The download Content-Length must be nonnegative.', 502);
        artifact = await artifacts.upload(context.grant.id, size, body);
    } else if (artifacts.ingest) artifact = await artifacts.ingest(context.grant.id, 2_000_000_000, body);
    else {
        const reader = body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
        while (true) {
            const next = await reader.read(); if (next.done) break;
            size += next.value.byteLength;
            if (size > 32 * 1024 * 1024) { void reader.cancel().catch(() => {}); throw new ServiceError('STREAM_REQUIRED', 'Unknown-length downloads require streaming artifact ingestion above 32 MiB.', 413); }
            chunks.push(next.value);
        }
        const blob = new Blob(chunks as BlobPart[]);
        artifact = await artifacts.upload(context.grant.id, blob.size, blob.stream());
    }
    return { artifact_id: artifact.id, size_bytes: artifact.size, filename: name, download_path: `/mcp/artifacts/${artifact.id}` };
}

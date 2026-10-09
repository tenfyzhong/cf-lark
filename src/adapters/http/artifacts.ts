import { safeError, ServiceError } from '../../domain/errors';
import type { Grant } from '../../domain/models';
import type { ArtifactFiles, ArtifactRange, ArtifactStore } from '../../ports/artifacts';

function parseRange(header: string, size: number): ArtifactRange | undefined {
    const match = /^bytes=(\d*)-(\d*)$/iu.exec(header.trim());
    if (!match || (!match[1] && !match[2]) || size <= 0) return;
    if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) return;
        const length = Math.min(suffix, size);
        return { offset: size - length, length };
    }
    const offset = Number(match[1]), end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || offset >= size || end < offset) return;
    return { offset, length: Math.min(end, size - 1) - offset + 1 };
}
async function readArtifact(request: Request, grant: Grant, store: ArtifactStore & Partial<Pick<ArtifactFiles, 'stat'>>, id: string): Promise<Response> {
    const requested = request.headers.get('Range');
    if (requested === null || request.headers.has('If-Range')) {
        const response = await store.read(grant.id, id);
        if (!store.stat) return response;
        const headers = new Headers(response.headers); headers.set('Accept-Ranges', 'bytes');
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    if (!store.stat) throw new ServiceError('RANGE_UNAVAILABLE', 'Artifact range reads are unavailable.', 503);
    const artifact = await store.stat(grant.id, id);
    const range = parseRange(requested, artifact.size);
    if (!range) return Response.json({ code: 'INVALID_RANGE', message: 'Provide one satisfiable byte range.' }, { status: 416, headers: { 'Content-Range': `bytes */${artifact.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' } });
    const response = await store.read(grant.id, id, range);
    if (!response.ok) return response;
    const headers = new Headers(response.headers);
    headers.set('Accept-Ranges', 'bytes'); headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${artifact.size}`); headers.set('Content-Length', String(range.length));
    return new Response(response.body, { status: 206, headers });
}

export async function artifactResponse(request: Request, grant: Grant, store: ArtifactStore & Partial<Pick<ArtifactFiles, 'stat'>>): Promise<Response> {
    try {
        if (grant.revoked || grant.expiresAt <= Date.now()) throw new ServiceError('GRANT_EXPIRED', 'Authorization has expired or was revoked.', 401);
        const permission = request.method === 'GET' ? 'read' : 'write';
        if (!grant.domains.includes('artifact') || !grant.permissions.includes(permission)) throw new ServiceError('FORBIDDEN', 'Artifact access requires the artifact domain and the corresponding operation permission.', 403);
        const path = new URL(request.url).pathname;
        const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
        if (path === '/mcp/artifacts/uploads' && request.method === 'POST') {
            if (!store.beginUpload) throw new ServiceError('UPLOAD_UNAVAILABLE', 'Resumable uploads are unavailable.', 503);
            const reader = request.body?.getReader();
            if (!reader) throw new ServiceError('INVALID_ARGUMENTS', 'Upload creation requires JSON with a size.');
            const chunks: Uint8Array[] = []; let length = 0;
            try {
                while (true) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > 65536) throw new ServiceError('BODY_TOO_LARGE', 'Upload metadata must not exceed 64 KiB.', 413); chunks.push(next.value); }
            } finally { void reader.cancel().catch(() => {}); }
            let input: unknown;
            try { input = JSON.parse(await new Blob(chunks as BlobPart[]).text()); } catch { throw new ServiceError('INVALID_ARGUMENTS', 'Upload creation requires valid JSON.'); }
            if (!input || typeof input !== 'object' || Array.isArray(input) || typeof (input as { size?: unknown }).size !== 'number') throw new ServiceError('INVALID_ARGUMENTS', 'Upload creation requires a numeric size.');
            return json(await store.beginUpload(grant.id, (input as { size: number }).size), 201);
        }
        const session = /^\/mcp\/artifacts\/uploads\/([A-Za-z0-9_-]+)(?:\/(complete|parts\/([1-9][0-9]*)))?$/u.exec(path);
        if (session) {
            const id = session[1]!;
            if (!session[2] && request.method === 'GET' && store.getUpload) return json(await store.getUpload(grant.id, id));
            if (!session[2] && request.method === 'DELETE' && store.abortUpload) { await store.abortUpload(grant.id, id); return json({ ok: true }); }
            if (session[2] === 'complete' && request.method === 'POST' && store.completeUpload) return json(await store.completeUpload(grant.id, id));
            if (session[3] && request.method === 'PUT' && store.uploadPart) {
                const size = Number(request.headers.get('Content-Length'));
                if (!Number.isSafeInteger(size) || size <= 0 || !request.body) throw new ServiceError('LENGTH_REQUIRED', 'An exact positive Content-Length is required.', 411);
                if (size > 64 * 1024 * 1024) throw new ServiceError('PART_TOO_LARGE', 'Upload parts must not exceed 64 MiB.', 413);
                return json(await store.uploadPart(grant.id, id, Number(session[3]), size, request.body));
            }
            throw new ServiceError('METHOD_NOT_ALLOWED', 'Unsupported upload session operation.', 405);
        }

        if (path === '/mcp/artifacts' && request.method === 'POST') {
            const length = request.headers.get('Content-Length'), size = Number(length);
            if (length === null || !Number.isSafeInteger(size) || size < 0 || (!request.body && size !== 0)) throw new ServiceError('LENGTH_REQUIRED', 'An exact nonnegative Content-Length is required.', 411);
            const body = request.body ?? new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
            const artifact = await store.upload(grant.id, size, body);
            return Response.json({ id: artifact.id, size: artifact.size, expiresAt: artifact.expiresAt }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
        }
        const id = /^\/mcp\/artifacts\/([A-Za-z0-9_-]+)$/u.exec(path)?.[1];
        if (!id) throw new ServiceError('NOT_FOUND', 'Artifact route not found.', 404);
        if (request.method === 'GET') return await readArtifact(request, grant, store, id);
        if (request.method === 'DELETE') {
            await store.remove(grant.id, id);
            return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
        }
        return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, DELETE' } });
    } catch (error) {
        return Response.json(safeError(error), { status: error instanceof ServiceError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
    }
}

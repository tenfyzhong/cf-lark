import { ServiceError } from '../../domain/errors';
import type { RemoteFiles } from '../../ports/remote-files';

function publicUrl(value: string): URL {
    let url: URL;
    try { url = new URL(value); } catch { throw new ServiceError('INVALID_REMOTE_URL', 'A public HTTP(S) file URL is required.'); }
    const host = url.hostname.toLowerCase().replace(/\.$/u, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
        || !host.includes('.') || /^[0-9.]+$/u.test(host) || host.includes(':')
        || /(?:^|\.)(?:localhost|local|internal|lan|home|localdomain)$/u.test(host)) {
        throw new ServiceError('INVALID_REMOTE_URL', 'A public HTTP(S) hostname without credentials or custom ports is required.');
    }
    return url;
}
function limit(value: number) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_000_000_000) throw new ServiceError('INVALID_SIZE', 'The transfer limit must be between one byte and 2 GB.');
}
function bounded(body: ReadableStream<Uint8Array>, maximum: number, exact?: number): ReadableStream<Uint8Array> {
    const reader = body.getReader(); let size = 0;
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const next = await reader.read();
            if (next.done) {
                if (exact !== undefined && size !== exact) throw new ServiceError('INVALID_SIZE', 'The remote transfer length did not match its declaration.', 502);
                controller.close(); return;
            }
            size += next.value.byteLength;
            if (size > maximum || (exact !== undefined && size > exact)) {
                void reader.cancel().catch(() => {});
                throw new ServiceError('REMOTE_TOO_LARGE', 'The remote file exceeds its transfer limit.', 413);
            }
            controller.enqueue(next.value);
        },
        cancel(reason) { return reader.cancel(reason); },
    });
}
function filename(response: Response, url: string): string {
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(disposition)?.[1];
    let value = /filename="?([^";]+)"?/iu.exec(disposition)?.[1] ?? new URL(url).pathname.split('/').at(-1) ?? 'download';
    if (encoded) { try { value = decodeURIComponent(encoded); } catch { /* Keep the plain filename when extended metadata is invalid. */ } }
    return value.replaceAll('\\', '/').split('/').at(-1)?.replace(/[\x00-\x1f\x7f]/gu, '').trim() || 'download';
}
export class HttpRemoteFiles implements RemoteFiles {
    constructor(private readonly send: (request: Request) => Promise<Response> = (request) => fetch(request)) {}
    async stream(value: string, maxBytes: number): Promise<Response> {
        limit(maxBytes); let url = publicUrl(value); const signal = AbortSignal.timeout(30_000);
        for (let redirects = 0; redirects <= 3; redirects++) {
            let response: Response;
            try { response = await this.send(new Request(url, { redirect: 'manual', signal, headers: { 'Accept-Encoding': 'identity' } })); }
            catch { throw new ServiceError('REMOTE_UNAVAILABLE', 'The remote file could not be reached.', 502); }
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                void response.body?.cancel().catch(() => {});
                const location = response.headers.get('Location');
                if (!location || redirects === 3) throw new ServiceError('REMOTE_REDIRECT_LIMIT', 'The remote file exceeded the redirect limit.', 502);
                url = publicUrl(new URL(location, url).href); continue;
            }
            if (!response.ok) throw new ServiceError('REMOTE_HTTP_ERROR', 'The remote file service rejected the request.', 502, { upstreamStatus: response.status });
            const length = response.headers.get('Content-Length'); const size = length === null ? undefined : Number(length);
            if (size !== undefined && (!Number.isSafeInteger(size) || size < 0 || size > maxBytes)) {
                void response.body?.cancel().catch(() => {});
                throw new ServiceError('REMOTE_TOO_LARGE', 'The remote file exceeds its transfer limit.', 413);
            }
            return new Response(response.body ? bounded(response.body, maxBytes, size) : null, { status: response.status, headers: response.headers });
        }
        throw new ServiceError('REMOTE_REDIRECT_LIMIT', 'The remote file exceeded the redirect limit.', 502);
    }
    async read(url: string, maxBytes: number) {
        if (maxBytes > 32 * 1024 * 1024) throw new ServiceError('BUFFER_LIMIT', 'Use streaming for remote files larger than 32 MiB.', 413);
        const response = await this.stream(url, maxBytes);
        return { body: await response.blob(), name: filename(response, url), contentType: response.headers.get('Content-Type') ?? 'application/octet-stream' };
    }
    async put(value: string, body: ReadableStream<Uint8Array>, size: number, options?: { contentType?: string; contentDisposition?: string }) {
        limit(size); const url = publicUrl(value);
        if (Object.values(options ?? {}).some((header) => /[\r\n\0]/u.test(header ?? ''))) throw new ServiceError('INVALID_FILE', 'Remote upload metadata must not contain control characters.');
        const source = bounded(body, size, size); const abort = new AbortController(); let transfer: Promise<void> | undefined;
        let stream = source;
        if (typeof FixedLengthStream !== 'undefined') {
            const fixed = new FixedLengthStream(size); transfer = source.pipeTo(fixed.writable, { signal: abort.signal }); stream = fixed.readable;
        }
        const request = new Request(url, { method: 'PUT', body: stream, redirect: 'manual', signal: AbortSignal.timeout(30_000),
            headers: { 'Content-Length': String(size), ...(options?.contentType ? { 'Content-Type': options.contentType } : {}),
                ...(options?.contentDisposition ? { 'Content-Disposition': options.contentDisposition } : {}) }, ...{ duplex: 'half' } });
        let response: Response;
        try { [response] = await Promise.all([this.send(request), transfer ?? Promise.resolve()]); }
        catch { abort.abort(); throw new ServiceError('OUTCOME_UNCERTAIN', 'The remote upload outcome could not be confirmed.', 502); }
        if (!response.ok) throw new ServiceError('REMOTE_HTTP_ERROR', 'The remote upload service rejected the request.', 502, { upstreamStatus: response.status });
        const etag = response.headers.get('ETag'); return etag === null ? {} : { etag };
    }
}

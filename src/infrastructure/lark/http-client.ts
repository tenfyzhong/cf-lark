import { ServiceError } from '../../domain/errors';
import type { Brand, JsonObject } from '../../domain/models';
import { endpoints, validateApiPath } from '../../domain/upstream';
import type { StreamingApiRequest, ApiRequest, DownloadRequest, LarkTransferClient, StreamingUploadRequest, UploadRequest } from '../../ports/lark';

export class LarkHttpClient implements LarkTransferClient {
    private requests = 0;

    constructor(
        readonly brand: Brand,
        private readonly getToken: () => Promise<string>,
        private readonly send: (request: Request) => Promise<Response> = (request) => fetch(request),
        private readonly maxRequests = 40,
        private readonly signal?: AbortSignal,
    ) {}

    async request(input: ApiRequest): Promise<JsonObject> {
        if (input.rawBody !== undefined) {
            if (input.body !== undefined) throw new ServiceError('INVALID_ARGUMENTS', 'Structured and raw JSON bodies are mutually exclusive.');
            try { JSON.parse(input.rawBody); } catch { throw new ServiceError('INVALID_ARGUMENTS', 'rawBody must contain valid JSON.'); }
        }
        return this.json(await this.exchange(input, input.rawBody ?? (input.body === undefined ? undefined : JSON.stringify(input.body)), 'application/json'), input.responseMode);
    }

    async requestStream(input: StreamingApiRequest): Promise<JsonObject> {
        const maximum = 64 * 1024 * 1024;
        if (input.method === 'GET') throw new ServiceError('INVALID_ARGUMENTS', 'Streamed JSON writes cannot use GET.');
        if (input.size !== undefined && (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > maximum)) throw new ServiceError('INVALID_SIZE', 'The JSON stream length must be positive and at most 64 MiB.');
        let bytes = 0;
        const body = input.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                bytes += chunk.byteLength;
                if (bytes > (input.size ?? maximum)) throw new ServiceError('INVALID_SIZE', 'The JSON stream exceeded its declared limit.');
                controller.enqueue(chunk);
            },
            flush() { if (input.size !== undefined && bytes !== input.size) throw new ServiceError('INVALID_SIZE', 'The JSON stream was shorter than its declared length.'); },
        }));
        return this.json(await this.exchange(input, body, 'application/json', input.size), input.responseMode);
    }

    async upload(input: UploadRequest): Promise<JsonObject> {
        return this.uploadStream({ ...input, file: { ...input.file, size: input.file.body.size, body: input.file.body.stream() } });
    }

    async uploadStream(input: StreamingUploadRequest): Promise<JsonObject> {
        const safe = (value: string) => Boolean(value) && !/[\r\n\0"/\\]/u.test(value);
        if (!safe(input.file.name) || !safe(input.file.field) || Object.keys(input.fields).some((key) => !safe(key))
            || !Number.isSafeInteger(input.file.size) || input.file.size <= 0) throw new ServiceError('INVALID_FILE', 'A nonempty file with safe multipart names and exact size is required.');
        const limit = input.path === '/open-apis/im/v1/images' ? 5 : input.path === '/open-apis/im/v1/files' ? 100
            : input.path === '/open-apis/task/v2/attachments/upload' ? 50 : 20;
        if (input.file.size > limit * 1024 * 1024) throw new ServiceError('FILE_TOO_LARGE', `This upload endpoint permits at most ${limit} MiB.`, 413);
        const boundary = `cf-lark-${crypto.randomUUID()}`;
        const encoder = new TextEncoder();
        const fields = Object.entries(input.fields).map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join('');
        const header = encoder.encode(`${fields}--${boundary}\r\nContent-Disposition: form-data; name="${input.file.field}"; filename="${input.file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
        const footer = encoder.encode(`\r\n--${boundary}--\r\n`);
        const reader = input.file.body.getReader(); let started = false; let finished = false; let size = 0;
        const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
                if (!started) { started = true; controller.enqueue(header); return; }
                if (finished) { controller.close(); return; }
                const next = await reader.read();
                if (next.done) {
                    if (size !== input.file.size) throw new ServiceError('INVALID_SIZE', 'The upload stream did not match its declared length.');
                    finished = true; controller.enqueue(footer); return;
                }
                size += next.value.byteLength;
                if (size > input.file.size) { void reader.cancel().catch(() => {}); throw new ServiceError('INVALID_SIZE', 'The upload stream exceeded its declared length.'); }
                controller.enqueue(next.value);
            },
            cancel(reason) { return reader.cancel(reason); },
        });
        return this.json(await this.exchange({ method: input.method ?? 'POST', path: input.path, query: input.query }, body,
            `multipart/form-data; boundary=${boundary}`, header.byteLength + input.file.size + footer.byteLength));
    }

    async download(input: DownloadRequest): Promise<Response> {
        const method = input.method ?? 'GET';
        if (method === 'GET' && input.body !== undefined) throw new ServiceError('INVALID_ARGUMENTS', 'GET downloads cannot include a body.');
        const response = await this.exchange({ ...input, method }, input.body === undefined ? undefined : JSON.stringify(input.body), input.body === undefined ? undefined : 'application/json');
        if (!response.body || response.headers.has('Content-Disposition')
            || !response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) return response;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        let ended = false;
        while (size <= 64 * 1024) {
            const next = await reader.read();
            if (next.done) { ended = true; break; }
            chunks.push(next.value);
            size += next.value.byteLength;
        }
        if (ended && size <= 64 * 1024) {
            let envelope: unknown;
            try { envelope = JSON.parse(await new Blob(chunks as BlobPart[]).text()); } catch { /* A JSON file may contain invalid JSON. */ }
            if (envelope && typeof envelope === 'object' && 'code' in envelope && 'msg' in envelope
                && typeof envelope.code === 'number' && envelope.code !== 0 && typeof envelope.msg === 'string') {
                throw new ServiceError('UPSTREAM_ERROR', 'The upstream API rejected the download.', 502, { upstreamCode: envelope.code });
            }
        }
        let index = 0;
        return new Response(new ReadableStream<Uint8Array>({
            async pull(controller) {
                if (index < chunks.length) { controller.enqueue(chunks[index++]!); return; }
                if (ended) { controller.close(); return; }
                const next = await reader.read();
                if (next.done) controller.close();
                else controller.enqueue(next.value);
            },
            cancel(reason) { return reader.cancel(reason); },
        }), { status: response.status, headers: response.headers });
    }

    private async exchange(input: ApiRequest, body?: BodyInit, contentType?: string, contentLength?: number): Promise<Response> {
        const path = validateApiPath(input.path);
        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(input.method)) {
            throw new ServiceError('INVALID_METHOD', 'Unsupported API method.');
        }
        if (this.requests >= this.maxRequests) throw new ServiceError('BUDGET_EXCEEDED', 'The invocation request budget is exhausted.', 429);
        this.requests++;
        const url = new URL(path, endpoints(this.brand).open);
        for (const [key, value] of Object.entries(input.query ?? {})) {
            if (value === undefined || value === null) continue;
            const encoding = input.queryEncoding?.[key] ?? 'json';
            if (encoding !== 'json' && Array.isArray(value)) {
                if (value.some((item) => !['string', 'number', 'boolean'].includes(typeof item))) throw new ServiceError('INVALID_QUERY', 'Repeated and comma-separated query values must be scalars.');
                if (encoding === 'repeat') for (const item of value) url.searchParams.append(key, String(item));
                else url.searchParams.set(key, value.join(','));
            } else url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        }
        const token = await this.getToken();
        const transfer = new AbortController();
        let bodyPipe: Promise<void> | undefined;
        if (contentLength !== undefined && body instanceof ReadableStream && typeof FixedLengthStream !== 'undefined') {
            const fixed = new FixedLengthStream(contentLength);
            bodyPipe = body.pipeTo(fixed.writable, { signal: transfer.signal });
            body = fixed.readable;
        }
        const request = new Request(url, {
            method: input.method,
            headers: { Authorization: `Bearer ${token}`, ...(contentType ? { 'Content-Type': contentType } : {}),
                ...(contentLength === undefined ? {} : { 'Content-Length': String(contentLength) }) },
            body,
            redirect: 'manual',
            signal: this.signal ?? AbortSignal.timeout(30_000),
            ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
        });
        let response: Response;
        try { [response] = await Promise.all([this.send(request), bodyPipe ?? Promise.resolve()]); } catch {
            transfer.abort();
            throw new ServiceError(input.method === 'GET' ? 'UPSTREAM_UNAVAILABLE' : 'OUTCOME_UNCERTAIN',
                input.method === 'GET' ? 'The upstream service could not be reached.' : 'The upstream write outcome could not be confirmed.', 502);
        }
        if (!response.ok) throw new ServiceError('UPSTREAM_HTTP_ERROR', 'The upstream service rejected the request.', 502, { upstreamStatus: response.status });
        return response;
    }

    private async json(response: Response, mode: ApiRequest['responseMode'] = 'data'): Promise<JsonObject> {
        let result: JsonObject;
        try { result = await response.json() as JsonObject; } catch {
            throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'The upstream response was not JSON.', 502);
        }
        if (result.code !== undefined && result.code !== 0) {
            const message = typeof result.msg === 'string' ? result.msg.toLowerCase() : '';
            const reason = message.includes('command already exists') ? 'command_already_exists'
                : result.code === 2 && message.includes('member_type') ? 'unsupported_member_type'
                : message.includes('server time out error') || message.includes('data not ready') ? 'transient_tool_failure'
                : message.includes('k_dl_1600039') && message.includes('lock already held') ? 'dts_lock_contention' : undefined;
            throw new ServiceError('UPSTREAM_ERROR', 'The upstream API rejected the operation.', 502, { upstreamCode: result.code,
                ...(reason ? { reason } : {}) });
        }
        return (mode === 'envelope' ? result : result.data ?? result) as JsonObject;
    }
}

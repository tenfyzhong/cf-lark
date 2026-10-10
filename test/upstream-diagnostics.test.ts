import { describe, expect, it, vi } from 'vitest';
import { safeError } from '../src/domain/errors';
import { LarkHttpClient } from '../src/infrastructure/lark/http-client';
import { upstreamError } from '../src/infrastructure/lark/upstream-errors';

const path = '/open-apis/test';
async function failure(response: Response, method: 'GET' | 'POST' = 'GET') {
    const send = vi.fn(async () => response);
    const client = new LarkHttpClient('feishu', async () => 'credential-secret', send);
    try { await client.request({ method, path }); } catch (error) { return { error: safeError(error), send }; }
    throw new Error('Expected a failure');
}

describe('sanitized upstream diagnostic contract', () => {
    it.each([
        [99991672, 'authorization', 'app_scope_missing'],
        [99991676, 'authorization', 'token_scope_missing'],
        [99991679, 'authorization', 'user_scope_missing'],
        [99991677, 'authentication', 'token_expired'],
        [99991668, 'authentication', 'token_invalid'],
        [99991663, 'authentication', 'token_invalid'],
        [99991400, 'rate_limit', 'rate_limited'],
    ])('classifies code %s with fixed safe guidance', async (code, type, subtype) => {
        const { error } = await failure(Response.json({ code, msg: 'credential-secret https://evil.example/?token=secret',
            error: { log_id: '202610100228001234ABCDEF', troubleshooter: 'https://evil.example/secret', details: 'secret' } }));
        expect(error).toMatchObject({ code: 'UPSTREAM_ERROR', details: { upstreamCode: code, type, subtype,
            log_id: '202610100228001234ABCDEF', retryable: code === 99991400,
            troubleshooter: { action: expect.any(String), message: expect.any(String) } } });
        expect(JSON.stringify(error)).not.toMatch(/credential-secret|evil\.example|details.*secret/u);
    });

    it('classifies HTTP failures and prefers trusted format headers without copying arbitrary fields', async () => {
        const { error } = await failure(Response.json({ code: 99991679, msg: 'secret', error: { log_id: 'https://evil.example' } },
            { status: 403, headers: { 'x-tt-logid': '20261010022800ABC123DEF456', 'retry-after': '10' } }));
        expect(error).toMatchObject({ code: 'UPSTREAM_HTTP_ERROR', details: { upstreamStatus: 403, upstreamCode: 99991679,
            subtype: 'user_scope_missing', log_id: '20261010022800ABC123DEF456', retryable: false } });
        expect(JSON.stringify(error)).not.toContain('secret');
    });

    it('does not infer a scope problem from HTTP 403 alone', async () => {
        const { error } = await failure(new Response('Access denied: secret', { status: 403 }));
        expect(error).toMatchObject({ details: { type: 'authorization', subtype: 'access_denied', retryable: false } });
    });

    it.each(['-1', '1.5', '999999999999', 'Bearer secret', 'https://evil.example'])('drops unsafe Retry-After %s', async (value) => {
        const { error } = await failure(new Response('', { status: 429, headers: { 'Retry-After': value } }));
        expect(error.details?.retry_after).toBeUndefined();
    });

    it('exposes bounded rate-limit retry hints but never labels a write safe to replay', async () => {
        const read = await failure(Response.json({ code: 99991400 }, { headers: { 'retry-after': '17' } }));
        const write = await failure(Response.json({ code: 99991400 }, { headers: { 'retry-after': '17' } }), 'POST');
        expect(read.error.details).toMatchObject({ retryable: true, retry_after: 17 });
        expect(write.error.details).toMatchObject({ retryable: false, retry_after: 17 });
        expect(read.send).toHaveBeenCalledOnce(); expect(write.send).toHaveBeenCalledOnce();
    });

    it.each([{ value: 'secret' }, 'secret', ['secret']])('never reflects malformed error codes %j', async (code) => {
        const { error } = await failure(Response.json({ code, msg: 'secret', log_id: 'secret' }));
        expect(error.code).toBe('UPSTREAM_ERROR');
        expect(error.details?.upstreamCode).toBeUndefined();
        expect(error.details?.log_id).toBeUndefined();
        expect(JSON.stringify(error)).not.toContain('secret');
    });

    it.each([null, [], 'secret', 123])('rejects malformed successful JSON shapes safely: %j', async (value) => {
        const { error } = await failure(Response.json(value));
        expect(error).toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
        expect(JSON.stringify(error)).not.toContain('secret');
    });

    it('accepts bounded HTTP-date Retry-After and rejects excessive delays', () => {
        const now = Date.UTC(2026, 9, 10, 0, 0, 0);
        const make = (date: string) => upstreamError({ brand: 'lark', method: 'GET', now,
            response: new Response('', { status: 503, headers: { 'Retry-After': date } }) });
        expect(make('Sat, 10 Oct 2026 00:00:19 GMT').details).toMatchObject({ retry_after_seconds: 19, retry_after: 19, retryable: true });
        expect(make('Mon, 12 Oct 2026 00:00:00 GMT').details?.retry_after_seconds).toBeUndefined();
    });

    it('bounds HTTP error inspection and does not return oversized payload content', async () => {
        const { error } = await failure(Response.json({ code: 99991679, msg: 'secret'.repeat(20000) }, { status: 429 }));
        expect(error).toMatchObject({ code: 'UPSTREAM_HTTP_ERROR', details: { subtype: 'rate_limited' } });
        expect(error.details?.upstreamCode).toBeUndefined();
        expect(JSON.stringify(error)).not.toContain('secret');
    });

    it('applies sanitization consistently to streaming and multipart write errors', async () => {
        const response = () => Response.json({ code: 99991679, msg: 'secret', error: { log_id: 'https://evil.example/?token=secret' } });
        const client = new LarkHttpClient('lark', async () => 'secret', async () => response());
        for (const operation of [
            () => client.requestStream({ method: 'PUT', path, body: new Response('{}').body! }),
            () => client.upload({ path, fields: {}, file: { name: 'file.txt', field: 'file', body: new Blob(['test']) } }),
        ]) {
            let caught: unknown;
            try { await operation(); } catch (error) { caught = error; }
            expect(caught).toMatchObject({ code: 'UPSTREAM_ERROR', details: { subtype: 'user_scope_missing', retryable: false, scope_details: 'unavailable' } });
            expect(JSON.stringify(safeError(caught))).not.toMatch(/secret|evil\.example/u);
        }
    });

    it.each([
        [429, 'k_dl_1600039 lock already held'],
        [503, 'k_dl_1600039 lock already held'],
        [403, 'command already exists'],
        [429, 'command already exists'],
        [503, 'server time out error'],
    ])('does not enable legacy workflow fallback from HTTP %s messages', async (status, msg) => {
        const { error, send } = await failure(Response.json({ code: 1, msg }, { status, headers: { 'Retry-After': '90' } }), 'POST');
        expect(error.details?.reason).toBeUndefined();
        expect(error.details?.retryable).toBe(false);
        expect(send).toHaveBeenCalledOnce();
    });

    it('does not derive a workflow reason without a valid nonzero API error code', () => {
        for (const code of [undefined, 0, 'secret', {}]) {
            expect(upstreamError({ brand: 'lark', method: 'POST', response: new Response(),
                body: { code, msg: 'k_dl_1600039 lock already held command already exists' } }).details?.reason).toBeUndefined();
        }
    });

    it('preserves uncertain write outcomes and does not retry transport failures', async () => {
        const send = vi.fn(async (): Promise<Response> => { throw new Error('token-secret'); });
        const client = new LarkHttpClient('lark', async () => 'credential-secret', send);
        await expect(client.request({ method: 'POST', path })).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN', details: { retryable: false } });
        expect(send).toHaveBeenCalledOnce();
    });

    it('classifies JSON download failures using the same safe fields', async () => {
        const client = new LarkHttpClient('lark', async () => 'secret', async () => Response.json({ code: 99991672, msg: 'secret',
            error: { log_id: '202610100228001234ABCDEF' } }));
        await expect(client.download({ path })).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', details: {
            subtype: 'app_scope_missing', retryable: false, log_id: '202610100228001234ABCDEF' } });
    });
});

import { expect, it } from 'vitest';
import { LarkHttpClient } from '../src/infrastructure/lark/http-client';
it.each([
    [2, 'invalid member_type secret', 'unsupported_member_type'],
    [3, 'invalid member_type secret', undefined],
    [1, 'SERVER TIME OUT ERROR secret', 'transient_tool_failure'],
    [1, 'data not ready secret', 'transient_tool_failure'],
    [1, 'k_dl_1600039 lock already held secret', 'dts_lock_contention'],
    [1, 'lock already held secret', undefined],
    [1, 'k_dl_1600039 secret', undefined],
])('classifies code %s and message %s without leaking text', async (code, msg, reason) => {
    const client = new LarkHttpClient('feishu', async () => 'token', async () => Response.json({ code, msg }));
    let caught: unknown;
    try { await client.request({ method: 'GET', path: '/open-apis/test' }); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: 'UPSTREAM_ERROR', details: { upstreamCode: code, ...(reason ? { reason } : {}) } });
    expect((caught as { details: { reason?: string } }).details.reason).toBe(reason);
    expect(JSON.stringify(caught)).not.toContain('secret');
});

it('preserves raw JSON numeric lexemes and rejects ambiguous or invalid bodies', async () => {
    const rawBody = '{"number":9007199254740993}';
    const client = new LarkHttpClient('feishu', async () => 'token', async (request) => {
        expect(await request.text()).toBe(rawBody);
        return Response.json({ data: {} });
    });
    await client.request({ method: 'POST', path: '/open-apis/test', rawBody });
    await expect(client.request({ method: 'POST', path: '/open-apis/test', rawBody: '{' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(client.request({ method: 'POST', path: '/open-apis/test', rawBody, body: {} })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});

it('preserves flexible upstream envelopes when explicitly requested', async () => {
    const envelope = { data: [{ log: 'entry' }], pagination: { total: 1 } };
    const client = new LarkHttpClient('feishu', async () => 'token', async () => Response.json(envelope));
    expect(await client.request({ method: 'GET', path: '/open-apis/test', responseMode: 'envelope' })).toEqual(envelope);
});

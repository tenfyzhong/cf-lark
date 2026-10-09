import { expect, it, vi } from 'vitest';
import { LarkHttpClient } from '../src/infrastructure/lark/http-client';
it('streams an authenticated JSON write without buffering or changing bytes', async () => {
    const raw = '{"raw":"YWJj"}';
    const send = vi.fn(async (request: Request) => {
        expect(request.headers.get('Authorization')).toBe('Bearer fixture');
        expect(request.headers.get('Content-Type')).toBe('application/json');
        expect(request.redirect).toBe('manual');
        expect(await request.text()).toBe(raw);
        return Response.json({ code: 0, data: { id: 'draft' } });
    });
    const client = new LarkHttpClient('feishu', async () => 'fixture', send);
    expect(await client.requestStream({ method: 'POST', path: '/open-apis/mail/v1/drafts', body: new Response(raw).body!, size: raw.length })).toEqual({ id: 'draft' });
    expect(send).toHaveBeenCalledTimes(1);
});
it('validates declared size before credentials and does not retry uncertain streams', async () => {
    const token = vi.fn(async () => 'fixture');
    const send = vi.fn(async () => { throw new Error('private network error'); });
    const client = new LarkHttpClient('feishu', token, send);
    await expect(client.requestStream({ method: 'POST', path: '/open-apis/mail/v1/drafts', body: new Response('{}').body!, size: -1 })).rejects.toMatchObject({ code: 'INVALID_SIZE' });
    expect(token).not.toHaveBeenCalled();
    await expect(client.requestStream({ method: 'PUT', path: '/open-apis/mail/v1/drafts/draft', body: new Response('{}').body! })).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
    expect(send).toHaveBeenCalledTimes(1);
});
it('rejects a mismatched streamed length as an uncertain write rather than retrying', async () => {
    const send = vi.fn(async (request: Request) => { await request.text(); return Response.json({ data: {} }); });
    const client = new LarkHttpClient('feishu', async () => 'fixture', send);
    await expect(client.requestStream({ method: 'POST', path: '/open-apis/test', body: new Response('abc').body!, size: 2 })).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
    expect(send).toHaveBeenCalledTimes(1);
});

import { decodeJwt, decodeProtectedHeader } from 'jose';
import { expect, it, vi } from 'vitest';
import { LarkHttpClient } from '../src/infrastructure/lark/http-client';
import { generateDpopKey } from '../src/infrastructure/lark/dpop';

it('signs every bound HTTP request with a fresh method and target-bound proof', async () => {
    const dpopKey = await generateDpopKey();
    const requests: Request[] = [];
    const send = vi.fn(async (request: Request) => { requests.push(request); return Response.json({ code: 0, data: {} }); });
    const client = new LarkHttpClient('lark', async () => ({ accessToken: 'user-secret', tokenType: 'DPoP', dpopKey }), send);
    await client.request({ method: 'GET', path: '/open-apis/test', query: { page: 1 } });
    await client.request({ method: 'POST', path: '/open-apis/test', body: {} });
    for (const [index, request] of requests.entries()) {
        expect(request.headers.get('Authorization')).toBe('DPoP user-secret');
        const proof = request.headers.get('DPoP'); expect(proof).toBeTruthy();
        expect(decodeProtectedHeader(proof!)).toMatchObject({ typ: 'dpop+jwt', alg: 'ES256' });
        expect(decodeJwt(proof!)).toMatchObject({ htm: index === 0 ? 'GET' : 'POST', htu: 'https://open.larksuite.com/open-apis/test', ath: expect.any(String) });
        expect(JSON.stringify(decodeJwt(proof!))).not.toContain('user-secret');
    }
    expect(decodeJwt(requests[0]!.headers.get('DPoP')!).jti).not.toBe(decodeJwt(requests[1]!.headers.get('DPoP')!).jti);
});

it('fails locally without downgrading or sending when a bound proof key is missing', async () => {
    const send = vi.fn(async () => Response.json({ code: 0 }));
    const client = new LarkHttpClient('feishu', async () => ({ accessToken: 'user-secret', tokenType: 'DPoP' }), send);
    await expect(client.request({ method: 'POST', path: '/open-apis/test', body: {} })).rejects.toMatchObject({ code: 'DPOP_KEY_MISSING' });
    expect(send).not.toHaveBeenCalled();
});

it('preserves legacy string credentials and structured Bearer credentials', async () => {
    const send = vi.fn(async (request: Request) => { expect(request.headers.get('Authorization')).toBe('Bearer user-secret'); expect(request.headers.has('DPoP')).toBe(false); return Response.json({ code: 0 }); });
    await new LarkHttpClient('feishu', async () => 'user-secret', send).request({ method: 'GET', path: '/open-apis/test' });
    await new LarkHttpClient('feishu', async () => ({ accessToken: 'user-secret', tokenType: 'Bearer' }), send).request({ method: 'GET', path: '/open-apis/test' });
    expect(send).toHaveBeenCalledTimes(2);
});

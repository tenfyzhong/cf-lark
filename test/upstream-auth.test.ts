import { describe, expect, it, vi } from 'vitest';
import { LarkAuthHttp } from '../src/infrastructure/lark/auth-http';

describe('upstream OAuth HTTP adapter', () => {
    const app = { brand: 'feishu' as const, appId: 'cli_id', appSecret: 'secret' };
    it('reads only user permissions from the selected application using its own tenant token', async () => {
        const send = vi.fn(async (request: Request) => {
            if (request.url.endsWith('/tenant_access_token/internal')) {
                expect(await request.json()).toEqual({ app_id: 'cli_id', app_secret: 'secret' });
                return Response.json({ code: 0, tenant_access_token: 'tenant-fixture', expire: 7200 });
            }
            expect(request.url).toBe('https://open.feishu.cn/open-apis/application/v6/applications/cli_id?lang=en_us');
            expect(request.headers.get('Authorization')).toBe('Bearer tenant-fixture');
            return Response.json({ code: 0, data: { app: { scopes: [
                { scope: 'docs:read', token_types: ['user'] },
                { scope: 'docs:write', token_types: ['tenant', 'user'] },
                { scope: 'bot:only', token_types: ['tenant'] },
                { scope: 'docs:read', token_types: ['user'] },
            ] } } });
        });
        expect(await new LarkAuthHttp(send).appUserScopes(app)).toEqual(['docs:read', 'docs:write']);
        expect(send).toHaveBeenCalledTimes(2);
    });
    it('fails closed when application permissions cannot be discovered', async () => {
        let calls = 0;
        const auth = new LarkAuthHttp(async () => ++calls === 1
            ? Response.json({ tenant_access_token: 'fixture', expire: 7200 })
            : Response.json({ code: 0, data: { app: {} } }));
        await expect(auth.appUserScopes(app)).rejects.toMatchObject({ code: 'APP_SCOPES_UNAVAILABLE' });
    });
    it('starts device authorization using application authentication', async () => {
        const send = vi.fn(async (_request: Request) => Response.json({ device_code: 'code', verification_uri: 'https://accounts.feishu.cn/v', expires_in: 600, interval: 5 }));
        const auth = new LarkAuthHttp(send);
        await auth.beginDevice(app, ['offline_access']);
        const req = send.mock.calls[0]![0];
        expect(req.url).toBe('https://accounts.feishu.cn/oauth/v1/device_authorization');
        expect(req.headers.get('Authorization')).toBe(`Basic ${btoa('cli_id:secret')}`);
        expect(new URLSearchParams(await req.text()).get('scope')).toBe('offline_access');
        expect(req.redirect).toBe('manual');
    });
    it.each([200, 204])('accepts empty revocation success (%s) with upstream form authentication', async (status) => {
        const send = vi.fn(async (_request: Request) => new Response(null, { status }));
        await expect(new LarkAuthHttp(send).revoke(app, 'access-token')).resolves.toBeUndefined();
        const request = send.mock.calls[0]![0];
        expect(request.url).toBe('https://accounts.feishu.cn/oauth/v1/revoke');
        const form = new URLSearchParams(await request.text());
        expect(Object.fromEntries(form)).toEqual({ client_id: 'cli_id', client_secret: 'secret', token: 'access-token' });
        expect(request.redirect).toBe('manual');
    });
    it('rejects failed revocation without exposing upstream response secrets', async () => {
        for (const response of [new Response(null, { status: 503 }), Response.json({ error: 'invalid_token', error_description: 'private-token' }), Response.json({ code: 42 })]) {
            await expect(new LarkAuthHttp(async () => response).revoke(app, 'token')).rejects.toMatchObject({ code: 'UPSTREAM_AUTH_ERROR' });
        }
        await expect(new LarkAuthHttp(async () => new Response(null)).refresh(app, 'token')).rejects.toMatchObject({ code: 'AUTH_UPSTREAM_INVALID' });
    });
    it('preserves pending and slow_down as device flow states', async () => {
        const auth = new LarkAuthHttp(async () => Response.json({ error: 'slow_down' }, { status: 400 }));
        expect(await auth.pollDevice(app, 'device')).toEqual({ error: 'slow_down' });
    });
    it('extracts user identity from a successful API envelope', async () => {
        const auth = new LarkAuthHttp(async () => Response.json({ code: 0, data: { open_id: 'owner', name: 'Owner' } }));
        expect(await auth.userInfo('feishu', 'token')).toEqual({ open_id: 'owner', name: 'Owner' });
    });
    it('rejects malformed successful token responses', async () => {
        const auth = new LarkAuthHttp(async () => Response.json({ code: 0 }));
        await expect(auth.refresh(app, 'refresh')).rejects.toThrow();
        await expect(auth.tenantToken(app)).rejects.toThrow();
    });
});

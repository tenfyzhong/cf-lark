import { describe, expect, it, vi } from 'vitest';
import { CredentialService } from '../src/application/credentials';
import { LarkAuthHttp } from '../src/infrastructure/lark/auth-http';
import { SecretBox } from '../src/infrastructure/crypto/secret-box';
import { MemoryCredentialStore } from './support/credential-store';

function setup(mode: 'preferred' | 'required' = 'required') {
    let now = 1_000_000;
    let responseType = 'DPoP';
    const send = vi.fn(async (request: Request) => {
        if (request.url.endsWith('/tenant_access_token/internal')) return Response.json({ tenant_access_token: 'tenant-fixture', expire: 7200 });
        if (request.url.includes('/applications/')) return Response.json({ app: { scopes: [{ scope: 'docs:read', token_types: ['user'] }] } });
        if (request.url.endsWith('/device_authorization')) return Response.json({ device_code: 'fixture-device', verification_uri: 'https://accounts.feishu.cn/verify', expires_in: 600, interval: 1 });
        if (request.url.endsWith('/user_info')) {
            expect(request.headers.get('Authorization')).toBe('DPoP fixture-access');
            expect(request.headers.get('DPoP')).toBeTruthy();
            return Response.json({ open_id: 'fixture-user', name: 'Fixture' });
        }
        expect(request.headers.get('DPoP')).toBeTruthy();
        return Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, refresh_token_expires_in: 7200, token_type: responseType, scope: 'docs:read' });
    });
    const store = new MemoryCredentialStore();
    const box = new SecretBox(btoa('k'.repeat(32)));
    const auth = new LarkAuthHttp(send, { protocol: 'oauthv3', dpopMode: mode });
    const service = new CredentialService(store, box, auth, () => now);
    return { service, store, box, auth, send, advance: (ms: number) => { now += ms; }, changeResponse: (type: string) => { responseType = type; }, now: () => now };
}

async function login(ctx: ReturnType<typeof setup>) {
    const profile = await ctx.service.create({ name: 'Fixture', brand: 'feishu', appId: 'fixture-id', appSecret: 'fixture-secret' });
    const flow = await ctx.service.beginLogin(profile.id);
    ctx.advance(1000);
    await ctx.service.pollLogin(flow.id);
    return { profile, flow };
}

describe('encrypted cloud proof credential lifecycle', () => {
    it('encrypts flow/account bindings, clears terminal flow keys, and restores them after restart', async () => {
        const ctx = setup();
        const { profile, flow } = await login(ctx);
        const account = (await ctx.store.getAccount(profile.id, 'fixture-user'))!;
        expect(account.tokenType).toBe('DPoP');
        expect(account.authorization).toBeTruthy();
        expect(JSON.stringify(account)).not.toContain('privateJwk');
        expect((await ctx.store.getFlow(flow.id))!.authorization).toBeUndefined();
        const restart = new CredentialService(ctx.store, ctx.box, ctx.auth, ctx.now);
        const credential = await restart.authorization(profile.id, 'user', 'fixture-user');
        expect(credential).toMatchObject({ accessToken: 'fixture-access', tokenType: 'DPoP', dpopKey: { privateJwk: expect.any(String) } });
        await expect(restart.token(profile.id, 'user', 'fixture-user')).rejects.toMatchObject({ code: 'DPOP_REQUIRED' });
        for (const output of [await restart.accounts(profile.id), await restart.flow(flow.id), await restart.list()]) {
            expect(JSON.stringify(output)).not.toMatch(/fixture-access|fixture-refresh|privateJwk|fixture-device/u);
        }
    });
    it('preserves the encrypted bound credential after refresh downgrade rejection', async () => {
        const ctx = setup();
        const { profile } = await login(ctx);
        const before = await ctx.store.getAccount(profile.id, 'fixture-user');
        ctx.advance(3_600_000);
        ctx.changeResponse('Bearer');
        await expect(ctx.service.authorization(profile.id, 'user', 'fixture-user')).rejects.toMatchObject({ code: 'DPOP_REQUIRED' });
        expect(await ctx.store.getAccount(profile.id, 'fixture-user')).toEqual(before);
    });
    it('rejects a missing bound key before making any request', async () => {
        const ctx = setup();
        const { profile } = await login(ctx);
        const account = (await ctx.store.getAccount(profile.id, 'fixture-user'))!;
        delete account.authorization;
        await ctx.store.putAccount(account);
        ctx.send.mockClear();
        await expect(ctx.service.authorization(profile.id, 'user', 'fixture-user')).rejects.toMatchObject({ code: 'DPOP_KEY_MISSING' });
        expect(ctx.send).not.toHaveBeenCalled();
    });
    it('blocks unbound user accounts under required mode while retaining bot behavior', async () => {
        const ctx = setup();
        const profile = await ctx.service.create({ name: 'Fixture', brand: 'feishu', appId: 'fixture-id', appSecret: 'fixture-secret' });
        await ctx.store.putAccount({ id: 'legacy', profileId: profile.id, name: 'Legacy', accessToken: 'unused', refreshToken: '', expiresAt: 99_000_000, refreshExpiresAt: 99_000_000, scopes: [] });
        await expect(ctx.service.authorization(profile.id, 'user', 'legacy')).rejects.toMatchObject({ code: 'DPOP_REQUIRED' });
        expect(await ctx.service.authorization(profile.id, 'bot')).toMatchObject({ tokenType: 'Bearer', accessToken: 'tenant-fixture' });
    });
    it('removes private flow state when authorization is cancelled', async () => {
        const ctx = setup();
        const profile = await ctx.service.create({ name: 'Fixture', brand: 'feishu', appId: 'fixture-id', appSecret: 'fixture-secret' });
        const flow = await ctx.service.beginLogin(profile.id);
        const stored = (await ctx.store.getFlow(flow.id))!;
        expect(stored.authorization).toBeTruthy();
        expect(stored.authorization).not.toContain('privateJwk');
        await ctx.service.cancelLogin(flow.id);
        expect((await ctx.store.getFlow(flow.id))!.authorization).toBeUndefined();
    });
});

it('inspects only safe stored metadata without decrypting, refreshing, or contacting upstream', async () => {
    const ctx = setup();
    const { profile } = await login(ctx);
    const decrypt = vi.spyOn(ctx.box, 'decrypt');
    ctx.send.mockClear();
    expect(await ctx.service.inspectAuthorization({ profileId: profile.id, accountId: 'fixture-user', identity: 'user' })).toMatchObject({ profileExists: true, credentialStatus: 'present', scopes: ['docs:read'], tokenType: 'DPoP', bindingStatus: 'bound' });
    expect(await ctx.service.inspectAuthorization({ profileId: profile.id, accountId: 'missing', identity: 'user' })).toEqual({ profileExists: true, credentialStatus: 'missing' });
    expect(await ctx.service.inspectAuthorization({ profileId: 'missing', identity: 'bot' })).toEqual({ profileExists: false, credentialStatus: 'missing' });
    expect(decrypt).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
});

it('refreshes concurrent bound requests once and retains their original proof key', async () => {
    const ctx = setup();
    const { profile } = await login(ctx);
    const original = await ctx.service.authorization(profile.id, 'user', 'fixture-user');
    ctx.advance(3_600_000);
    ctx.send.mockClear();
    const results = await Promise.all(Array.from({ length: 5 }, () => ctx.service.authorization(profile.id, 'user', 'fixture-user')));
    expect(results.every((value) => value.dpopKey!.jkt === original.dpopKey!.jkt)).toBe(true);
    expect(ctx.send).toHaveBeenCalledOnce();
});

it('rejects damaged encrypted binding metadata without exposing it or sending upstream', async () => {
    const ctx = setup();
    const { profile } = await login(ctx);
    const account = (await ctx.store.getAccount(profile.id, 'fixture-user'))!;
    account.authorization = 'fixture-corrupt-private-key';
    await ctx.store.putAccount(account);
    ctx.send.mockClear();
    await expect(ctx.service.authorization(profile.id, 'user', 'fixture-user')).rejects.toMatchObject({ code: 'DPOP_KEY_MISSING' });
    expect(ctx.send).not.toHaveBeenCalled();
});

it('clears expired flow proof state and preserves state while waiting for authorization', async () => {
    const ctx = setup();
    const profile = await ctx.service.create({ name: 'Fixture', brand: 'feishu', appId: 'fixture-id', appSecret: 'fixture-secret' });
    const flow = await ctx.service.beginLogin(profile.id);
    ctx.advance(1000);
    ctx.send.mockResolvedValueOnce(Response.json({ error: 'authorization_pending' }, { status: 400 }));
    expect(await ctx.service.pollLogin(flow.id)).toMatchObject({ status: 'pending' });
    expect((await ctx.store.getFlow(flow.id))!.authorization).toBeTruthy();
    ctx.advance(600_000);
    expect(await ctx.service.pollLogin(flow.id)).toMatchObject({ status: 'expired' });
    expect((await ctx.store.getFlow(flow.id))!.authorization).toBeUndefined();
});

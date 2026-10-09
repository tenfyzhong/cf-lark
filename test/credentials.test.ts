import { describe, expect, it, vi } from 'vitest';
import { CredentialService } from '../src/application/credentials';
import { SecretBox } from '../src/infrastructure/crypto/secret-box';
import { MemoryCredentialStore } from './support/credential-store';

function setup() {
    let now = 1_000_000;
    const store = new MemoryCredentialStore();
    const upstream = {
        appUserScopes: vi.fn(async () => ['calendar:calendar:read', 'calendar:calendar:read']),
        beginDevice: vi.fn(async () => ({ device_code: 'upstream-device', verification_uri: 'https://accounts.feishu.cn/verify', expires_in: 600, interval: 5 })),
        pollDevice: vi.fn(async () => ({ access_token: 'user-token', refresh_token: 'refresh-token', expires_in: 3600, refresh_token_expires_in: 7200, scope: 'calendar:calendar:read' })),
        userInfo: vi.fn(async () => ({ open_id: 'account-1', name: 'Owner' })),
        refresh: vi.fn(async () => ({ access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600, refresh_token_expires_in: 7200, scope: 'calendar:calendar:read' })),
        tenantToken: vi.fn(async () => ({ tenant_access_token: 'bot-token', expire: 7200 })),
        revoke: vi.fn(async () => undefined),
    };
    const service = new CredentialService(store, new SecretBox(btoa('k'.repeat(32))), upstream, () => now);
    return { service, store, upstream, advance: (ms: number) => { now += ms; } };
}

describe('application credential lifecycle', () => {
    it('stores encrypted credentials and returns only public profile metadata', async () => {
        const { service, store } = setup();
        const profile = await service.create({ name: 'Personal', brand: 'feishu', appId: 'cli_test', appSecret: 'secret' });
        expect(JSON.stringify(profile)).not.toContain('secret');
        expect(JSON.stringify(await service.list())).not.toContain('secret');
        expect((await store.getProfile(profile.id))!.secret).not.toBe('secret');
    });
    it('discovers all enabled user scopes and adds refresh permission without caller input', async () => {
        const { service, upstream } = setup();
        const profile = await service.create({ name: 'Personal', brand: 'feishu', appId: 'cli_test', appSecret: 'secret' });
        await service.beginLogin(profile.id);
        expect(upstream.appUserScopes).toHaveBeenCalledWith({ brand: 'feishu', appId: 'cli_test', appSecret: 'secret' });
        expect(upstream.beginDevice).toHaveBeenCalledWith(expect.anything(), ['calendar:calendar:read', 'offline_access']);
        upstream.appUserScopes.mockRejectedValueOnce(new Error('Scope discovery unavailable'));
        await expect(service.beginLogin(profile.id)).rejects.toThrow('Scope discovery unavailable');
        expect(upstream.beginDevice).toHaveBeenCalledTimes(1);
    });
    it('keeps device codes private and enforces polling intervals', async () => {
        const { service, upstream, advance } = setup();
        const profile = await service.create({ name: 'Personal', brand: 'feishu', appId: 'cli_test', appSecret: 'secret' });
        const flow = await service.beginLogin(profile.id);
        expect(JSON.stringify(flow)).not.toContain('upstream-device');
        await expect(service.pollLogin(flow.id)).rejects.toMatchObject({ code: 'POLL_TOO_EARLY' });
        advance(5000);
        expect(await service.pollLogin(flow.id)).toMatchObject({ status: 'authorized', accountId: 'account-1' });
        expect(await service.token(profile.id, 'user', 'account-1')).toBe('user-token');
        expect(upstream.tenantToken).not.toHaveBeenCalled();
        expect(JSON.stringify(await service.accounts(profile.id))).not.toContain('user-token');
    });
    it('refreshes concurrent account requests once', async () => {
        const { service, upstream, advance } = setup();
        const profile = await service.create({ name: 'Personal', brand: 'feishu', appId: 'cli_test', appSecret: 'secret' });
        const flow = await service.beginLogin(profile.id);
        advance(5000);
        await service.pollLogin(flow.id);
        advance(3_600_000);
        const tokens = await Promise.all(Array.from({ length: 5 }, () => service.token(profile.id, 'user', 'account-1')));
        expect(tokens).toEqual(Array(5).fill('new-token'));
        expect(upstream.refresh).toHaveBeenCalledOnce();
    });
    it('never falls back to a bot token for an unauthorized account', async () => {
        const { service, upstream } = setup();
        const profile = await service.create({ name: 'Personal', brand: 'feishu', appId: 'cli_test', appSecret: 'secret' });
        await expect(service.token(profile.id, 'user', 'missing')).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
        expect(upstream.tenantToken).not.toHaveBeenCalled();
    });
    it('invalidates pending flows after a secret change or cancellation', async () => {
        const { service, advance } = setup();
        const profile = await service.create({ name: 'Personal', brand: 'feishu', appId: 'cli_test', appSecret: 'secret' });
        const flow = await service.beginLogin(profile.id);
        await service.update(profile.id, { appSecret: 'replacement' });
        advance(5000);
        await expect(service.pollLogin(flow.id)).rejects.toMatchObject({ code: 'FLOW_INVALIDATED' });
        const another = await service.beginLogin(profile.id);
        await service.cancelLogin(another.id);
        await expect(service.pollLogin(another.id)).rejects.toMatchObject({ code: 'FLOW_INACTIVE' });
    });
    it('removes account access when a profile is deleted', async () => {
        const { service } = setup();
        const profile = await service.create({ name: 'Personal', brand: 'feishu', appId: 'cli_test', appSecret: 'secret' });
        await service.remove(profile.id);
        await expect(service.token(profile.id, 'bot')).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' });
    });
});

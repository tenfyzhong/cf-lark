import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import type { Env } from '../../src/bootstrap/worker';
import { LarkAuthHttp } from '../../src/infrastructure/lark/auth-http';
import { LarkHttpClient } from '../../src/infrastructure/lark/http-client';
import { generateDpopKey } from '../../src/infrastructure/lark/dpop';
import { CredentialService } from '../../src/application/credentials';
import { SecretBox } from '../../src/infrastructure/crypto/secret-box';
import { SqliteCredentialStore } from '../../src/infrastructure/storage/credential-store';

async function verifyProof(request: Request, token?: string) {
    const proof = request.headers.get('DPoP')!;
    expect(proof).toBeTruthy();
    const header = decodeProtectedHeader(proof);
    expect(header.jwk).not.toHaveProperty('d');
    const { payload } = await jwtVerify(proof, await importJWK(header.jwk!, 'ES256'));
    const target = new URL(request.url);
    expect(payload.htm).toBe(request.method);
    expect(payload.htu).toBe(target.origin + target.pathname);
    if (token) {
        expect(request.headers.get('Authorization')).toBe(`DPoP ${token}`);
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
        expect(payload.ath).toBe(btoa(String.fromCharCode(...hash)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''));
    } else expect(payload).not.toHaveProperty('ath');
    return payload.jti!;
}

describe('Cloudflare native DPoP fixture verification', () => {
    it('encrypts and restores bound credentials in Durable Object SQLite, then refreshes under disabled mode', async () => {
        await runInDurableObject((env as unknown as Env).AUTHORITY.getByName('cloud-dpop-storage'), async (_instance, state) => {
            let now = 1_000_000;
            let counter = 0;
            const proofs: string[] = [];
            const send = async (request: Request) => {
                if (request.url.endsWith('/tenant_access_token/internal')) return Response.json({ tenant_access_token: 'native-tenant', expire: 7200 });
                if (request.url.includes('/applications/')) return Response.json({ app: { scopes: [] } });
                if (request.url.endsWith('/device_authorization')) return Response.json({ device_code: 'native-code', verification_uri: 'https://accounts.feishu.cn/verify', expires_in: 600, interval: 1 });
                if (request.url.endsWith('/user_info')) {
                    proofs.push(await verifyProof(request, 'native-access-1'));
                    return Response.json({ open_id: 'native-user' });
                }
                expect(request.url).toBe('https://accounts.feishu.cn/oauth/v3/token');
                proofs.push(await verifyProof(request));
                if (counter++) {
                    expect(request.headers.get('Content-Type')).toContain('application/json');
                    expect(await request.json()).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'native-refresh' });
                }
                return Response.json({ access_token: `native-access-${counter}`, refresh_token: 'native-refresh', expires_in: 3600, refresh_token_expires_in: 7200, token_type: 'DPoP' });
            };
            let store = new SqliteCredentialStore(state.storage.sql);
            const box = new SecretBox((env as unknown as Env).ENCRYPTION_KEY);
            let credentials = new CredentialService(store, box, new LarkAuthHttp(send, { protocol: 'oauthv3', dpopMode: 'required' }), () => now);
            const profile = await credentials.create({ name: 'Native fixture', brand: 'feishu', appId: 'native-app', appSecret: 'native-secret' });
            const flow = await credentials.beginLogin(profile.id);
            now += 1000;
            await credentials.pollLogin(flow.id);
            const before = await credentials.authorization(profile.id, 'user', 'native-user');
            const persisted = [...state.storage.sql.exec('SELECT value FROM credential_accounts WHERE profile = ?', profile.id)];
            expect(JSON.stringify(persisted)).not.toMatch(/privateJwk|native-access|native-refresh/u);
            expect((await store.getFlow(flow.id))!.authorization).toBeUndefined();
            store = new SqliteCredentialStore(state.storage.sql);
            credentials = new CredentialService(store, box, new LarkAuthHttp(send), () => now);
            now += 3_600_000;
            const after = await credentials.authorization(profile.id, 'user', 'native-user');
            expect(after).toMatchObject({ accessToken: 'native-access-2', tokenType: 'DPoP', dpopKey: { jkt: before.dpopKey!.jkt } });
            expect(new Set(proofs).size).toBe(proofs.length);
            await credentials.remove(profile.id);
            expect(await store.getAccount(profile.id, 'native-user')).toBeUndefined();
        });
    });

    it('adds a fresh verified proof to JSON, streaming, upload, and download requests', async () => {
        const authorization = { accessToken: 'native-resource', tokenType: 'DPoP' as const, dpopKey: await generateDpopKey() };
        const proofs: string[] = [];
        const client = new LarkHttpClient('lark', async () => authorization, async (request) => {
            expect(request.redirect).toBe('manual');
            proofs.push(await verifyProof(request, authorization.accessToken));
            if (request.body) await request.arrayBuffer();
            if (request.url.includes('/download')) return new Response('file', { headers: { 'Content-Type': 'application/octet-stream' } });
            return Response.json({ code: 0, data: { ok: true } });
        });
        expect(await client.request({ method: 'POST', path: '/open-apis/test', body: {}, query: { cursor: 'fixture' } })).toEqual({ ok: true });
        expect(await client.requestStream({ method: 'POST', path: '/open-apis/stream', body: new Blob(['{}']).stream(), size: 2 })).toEqual({ ok: true });
        expect(await client.upload({ path: '/open-apis/im/v1/files', fields: {}, file: { name: 'fixture.txt', field: 'file', body: new Blob(['file']) } })).toEqual({ ok: true });
        expect(new TextDecoder().decode(await (await client.download({ path: '/open-apis/download' })).arrayBuffer())).toBe('file');
        expect(proofs.length).toBe(4);
        expect(new Set(proofs).size).toBe(4);
    });

    it('rejects missing keys before reaching the Cloudflare resource transport', async () => {
        let requests = 0;
        const client = new LarkHttpClient('feishu', async () => ({ accessToken: 'fixture', tokenType: 'DPoP' }), async () => { requests++; return Response.json({}); });
        await expect(client.request({ method: 'POST', path: '/open-apis/test', body: {} })).rejects.toMatchObject({ code: 'DPOP_KEY_MISSING' });
        expect(requests).toBe(0);
    });
});

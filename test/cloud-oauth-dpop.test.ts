import { describe, expect, it } from 'vitest';
import { LarkAuthHttp } from '../src/infrastructure/lark/auth-http';

const app = { brand: 'feishu' as const, appId: 'fixture-app', appSecret: 'fixture-secret' };

describe('opt-in cloud OAuth protocol', () => {
    it('uses the v3 accounts endpoint only when explicitly selected', async () => {
        let url = '';
        const auth = new LarkAuthHttp(async (request) => {
            url = request.url;
            return Response.json({ access_token: 'fixture-access', expires_in: 3600, token_type: 'Bearer' });
        }, { protocol: 'oauthv3', dpopMode: 'disabled' });
        await auth.refresh(app, 'fixture-refresh');
        expect(url).toBe('https://accounts.feishu.cn/oauth/v3/token');
    });
});

import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { authorizationHeaders, generateDpopKey, tokenProof, parseOAuthOptions } from '../src/infrastructure/lark/dpop';

it('preserves legacy defaults and rejects invalid deployment policy', () => {
    expect(parseOAuthOptions()).toEqual({ protocol: 'legacy', dpopMode: 'disabled' });
    expect(() => parseOAuthOptions('legacy', 'required')).toThrow();
    expect(() => parseOAuthOptions('typo', 'disabled')).toThrow();
    expect(() => parseOAuthOptions('oauthv3', 'typo')).toThrow();
});

it('signs verifiable per-request proofs with a token hash and public-only key', async () => {
    const dpopKey = await generateDpopKey();
    const auth = { accessToken: 'fixture-access', tokenType: 'DPoP' as const, dpopKey };
    const first = await authorizationHeaders(auth, 'post', 'https://OPEN.feishu.cn:443/open-apis/test/%7euser?q=private#fragment');
    const second = await authorizationHeaders(auth, 'post', 'https://open.feishu.cn/open-apis/test/~user');
    const header = decodeProtectedHeader(first.DPoP!);
    expect(header).toMatchObject({ typ: 'dpop+jwt', alg: 'ES256', jwk: { kty: 'EC', crv: 'P-256' } });
    expect(header.jwk).not.toHaveProperty('d');
    const claims = (await jwtVerify(first.DPoP!, await importJWK(header.jwk!, 'ES256'))).payload;
    expect(first.Authorization).toBe('DPoP fixture-access');
    expect(claims).toMatchObject({ htm: 'POST', htu: 'https://open.feishu.cn/open-apis/test/~user' });
    expect(claims.ath).toMatch(/^[\w-]{43}$/u);
    expect(Number.isInteger(claims.iat)).toBe(true);
    expect(claims.jti).not.toBe(decodeJwt(second.DPoP!).jti);
    const proof = await tokenProof(dpopKey, 'POST', 'https://accounts.feishu.cn/oauth/v3/token');
    expect(decodeJwt(proof)).not.toHaveProperty('ath');
});

it('fails closed for missing, invalid, and mismatched binding keys', async () => {
    const key = await generateDpopKey();
    await expect(authorizationHeaders({ accessToken: 'fixture', tokenType: 'DPoP' }, 'GET', 'https://open.feishu.cn/')).rejects.toMatchObject({ code: 'DPOP_KEY_MISSING' });
    await expect(authorizationHeaders({ accessToken: 'fixture', tokenType: 'DPoP', dpopKey: { ...key, jkt: 'wrong' } }, 'GET', 'https://open.feishu.cn/')).rejects.toMatchObject({ code: 'DPOP_BINDING_MISMATCH' });
    await expect(tokenProof({ privateJwk: 'not-json', jkt: key.jkt }, 'GET', 'https://open.feishu.cn/')).rejects.toMatchObject({ code: 'DPOP_KEY_MISSING' });
    await expect(authorizationHeaders({ accessToken: 'fixture', tokenType: 'Bearer', dpopKey: key }, 'GET', 'https://open.feishu.cn/')).rejects.toMatchObject({ code: 'DPOP_BINDING_MISMATCH' });
});

it.each(['feishu', 'lark'] as const)('persists issuance proof context and refreshes bound %s credentials without downgrading', async (brand) => {
    const seen: Request[] = [];
    const auth = new LarkAuthHttp(async (request) => {
        seen.push(request);
        if (request.url.endsWith('device_authorization')) return Response.json({ device_code: 'device', verification_uri: `https://accounts.${brand === 'feishu' ? 'feishu.cn' : 'larksuite.com'}/verify`, expires_in: 600, interval: 5 });
        return Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'DPoP' });
    }, { protocol: 'oauthv3', dpopMode: 'required' });
    const flow = await auth.beginDevice({ ...app, brand }, ['offline_access']);
    const token = await auth.pollDevice({ ...app, brand }, flow.device_code, flow.authorization);
    expect(token).toMatchObject({ token_type: 'DPoP', authorization: { protocol: 'oauthv3', tokenType: 'DPoP', dpopKey: { jkt: flow.authorization!.dpopKey!.jkt } } });
    if ('error' in token) throw new Error('Unexpected fixture error');
    expect(seen[1]!.headers.get('DPoP')).toBeTruthy();
    expect(seen[1]!.url).toBe(`https://accounts.${brand === 'feishu' ? 'feishu.cn' : 'larksuite.com'}/oauth/v3/token`);
    const disabled = new LarkAuthHttp(async (request) => {
        expect(request.headers.get('DPoP')).toBeTruthy();
        expect(request.url).toBe(seen[1]!.url);
        return Response.json({ access_token: 'downgraded', expires_in: 3600, token_type: 'Bearer' });
    });
    await expect(disabled.refresh({ ...app, brand }, 'fixture-refresh', token.authorization)).rejects.toMatchObject({ code: 'DPOP_REQUIRED' });
});

it.each(['preferred', 'required'] as const)('only permits explicit initial Bearer fallback in preferred mode (%s)', async (dpopMode) => {
    const auth = new LarkAuthHttp(async (request) => request.url.endsWith('device_authorization')
        ? Response.json({ device_code: 'device', verification_uri: 'https://accounts.feishu.cn/verify', expires_in: 600, interval: 5 })
        : Response.json({ access_token: 'fixture', expires_in: 3600, token_type: 'Bearer' }), { protocol: 'oauthv3', dpopMode });
    const flow = await auth.beginDevice(app, []);
    if (dpopMode === 'preferred') expect(await auth.pollDevice(app, 'device', flow.authorization)).toMatchObject({ authorization: { tokenType: 'Bearer' } });
    else await expect(auth.pollDevice(app, 'device', flow.authorization)).rejects.toMatchObject({ code: 'DPOP_REQUIRED' });
});

it('does not accept an unsolicited bound token or echo an OAuth error description', async () => {
    const auth = new LarkAuthHttp(async () => Response.json({ access_token: 'fixture', expires_in: 3600, token_type: 'DPoP' }));
    await expect(auth.refresh(app, 'refresh')).rejects.toMatchObject({ code: 'DPOP_KEY_MISSING' });
    const rejected = new LarkAuthHttp(async () => Response.json({ error: 'invalid_dpop_proof', error_description: 'private-material' }, { status: 400 }), { protocol: 'oauthv3', dpopMode: 'required' });
    await expect(rejected.pollDevice(app, 'code', { protocol: 'oauthv3', dpopMode: 'required', dpopKey: await generateDpopKey() })).rejects.toMatchObject({ code: 'DPOP_TOKEN_REJECTED' });
});

it('keeps the proof origin for double-slash paths and rejects unsafe proof URLs', async () => {
    const key = await generateDpopKey();
    expect(decodeJwt(await tokenProof(key, 'GET', 'https://open.feishu.cn//other.example/path?q=1')).htu).toBe('https://open.feishu.cn//other.example/path');
    for (const url of ['http://open.feishu.cn/a', 'https://user:pass@open.feishu.cn/a', 'https://open.feishu.cn/%bad%xx']) {
        await expect(tokenProof(key, 'GET', url)).rejects.toMatchObject({ code: 'DPOP_PROOF_FAILED' });
    }
});

it('rejects mismatched private/public keys even if the public thumbprint matches', async () => {
    const first = await generateDpopKey();
    const second = await generateDpopKey();
    const corrupted = { ...first, privateJwk: JSON.stringify({ ...JSON.parse(first.privateJwk), d: JSON.parse(second.privateJwk).d }) };
    await expect(tokenProof(corrupted, 'POST', 'https://accounts.feishu.cn/oauth/v3/token')).rejects.toMatchObject({ code: 'DPOP_BINDING_MISMATCH' });
});

it.each(['preferred', 'required'] as const)('never retries a rejected proof as Bearer in %s mode', async (dpopMode) => {
    let calls = 0;
    const auth = new LarkAuthHttp(async () => {
        calls++;
        return Response.json({ error: 'invalid_dpop_proof', error_description: 'fixture-private' }, { status: 400 });
    }, { protocol: 'oauthv3', dpopMode });
    await expect(auth.pollDevice(app, 'fixture-code', { protocol: 'oauthv3', dpopMode, dpopKey: await generateDpopKey() })).rejects.toMatchObject({ code: 'DPOP_TOKEN_REJECTED' });
    expect(calls).toBe(1);
});

it('uses the saved legacy protocol when opt-in changes and rejects unknown token types', async () => {
    let seen: Request | undefined;
    const auth = new LarkAuthHttp(async (request) => {
        seen = request;
        return Response.json({ access_token: 'fixture', token_type: 'unexpected', expires_in: 3600 });
    }, { protocol: 'oauthv3', dpopMode: 'preferred' });
    await expect(auth.refresh(app, 'refresh', { protocol: 'legacy', tokenType: 'Bearer' })).rejects.toMatchObject({ code: 'AUTH_UPSTREAM_INVALID' });
    expect(seen!.url).toBe('https://open.feishu.cn/open-apis/authen/v2/oauth/token');
    expect(seen!.headers.get('DPoP')).toBeNull();
});

it('applies a stricter required policy to an existing preferred authorization flow', async () => {
    const auth = new LarkAuthHttp(async () => Response.json({ access_token: 'fixture', token_type: 'Bearer', expires_in: 3600 }), { protocol: 'oauthv3', dpopMode: 'required' });
    await expect(auth.pollDevice(app, 'fixture-code', { protocol: 'oauthv3', dpopMode: 'preferred', dpopKey: await generateDpopKey() })).rejects.toMatchObject({ code: 'DPOP_REQUIRED' });
});

import { expect, it, vi } from 'vitest';
import { AccessSessions } from '../src/infrastructure/auth/access-sessions';
import { accessAudience, accessIssuer, accessJwks, accessToken } from './support/access-fixture';

const origin = 'https://service.example';
const request = (token?: string, init: RequestInit = {}) => new Request(origin + '/api/admin/session', {
    ...init, headers: { ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}), ...init.headers },
});
const create = () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json(accessJwks));
    return { service: new AccessSessions({ issuer: accessIssuer, audience: accessAudience, emailDomain: 'example.com', origin }, fetcher), fetcher };
};

it('verifies signed Access identity and caches the configured JWKS', async () => {
    const { service, fetcher } = create();
    const token = await accessToken();
    const session = await service.require(request(token));
    expect(session).toMatchObject({ email: 'admin@example.com' });
    expect(session.csrf).toBeTruthy();
    expect(await service.require(request(token))).toEqual(session);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(accessIssuer + '/cdn-cgi/access/certs');
});

it('requires exact origin and assertion-bound CSRF for every mutation', async () => {
    const { service } = create();
    const token = await accessToken();
    const session = await service.require(request(token));
    await expect(service.require(request(token, { method: 'POST' }))).rejects.toMatchObject({ status: 403 });
    await expect(service.require(request(token, { method: 'POST', headers: { Origin: 'https://evil.example', 'X-CSRF-Token': session.csrf } }))).rejects.toMatchObject({ status: 403 });
    expect(await service.require(request(token, { method: 'POST', headers: { Origin: origin, 'X-CSRF-Token': session.csrf } }))).toEqual(session);
    const other = await accessToken({ sub: 'other-user' });
    await expect(service.require(request(other, { method: 'POST', headers: { Origin: origin, 'X-CSRF-Token': session.csrf } }))).rejects.toMatchObject({ status: 403 });
});

for (const email of ['admin@evil.example', 'admin@example.com.evil.example', 'admin@sub.example.com', '@example.com', 'admin@example.com\n', undefined]) {
    it(`rejects an unauthorized email claim: ${String(email)}`, async () => {
        await expect(create().service.require(request(await accessToken({ email })))).rejects.toMatchObject({ status: 401 });
    });
}

it('rejects invalid signatures, expired tokens, foreign issuer/AUD and legacy credentials', async () => {
    const { service } = create();
    const token = await accessToken();
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    parts[1] = Buffer.from(JSON.stringify({ ...payload, email: 'attacker@example.com' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    for (const invalid of [
        parts.join('.'), 'not-a-jwt', await accessToken({ exp: now - 1 }),
        await accessToken({ iat: now + 3600 }), await accessToken({}, 'https://evil.cloudflareaccess.com'),
    ]) await expect(service.require(request(invalid))).rejects.toMatchObject({ status: 401 });
    await expect(new AccessSessions({ issuer: accessIssuer, audience: 'foreign-aud', emailDomain: 'example.com', origin },
        async () => Response.json(accessJwks)).require(request(token))).rejects.toMatchObject({ status: 401 });
    await expect(service.require(request(undefined, { headers: { Cookie: '__Host-lark-admin=old-secret-session', 'Cf-Access-Authenticated-User-Email': 'admin@example.com' } }))).rejects.toMatchObject({ status: 401 });
});

it('fails closed on JWKS errors and rejects insecure public configuration', async () => {
    await expect(new AccessSessions({ issuer: accessIssuer, audience: accessAudience, emailDomain: 'example.com', origin },
        async () => { throw new Error('private failure'); }).require(request(await accessToken()))).rejects.toMatchObject({ status: 401 });
    expect(() => new AccessSessions({ issuer: 'http://evil.example', audience: accessAudience, emailDomain: 'example.com', origin })).toThrow();
    expect(() => new AccessSessions({ issuer: 'https://evil.example', audience: accessAudience, emailDomain: 'example.com', origin })).toThrow();
    for (const response of [
        new Response(null, { status: 302, headers: { Location: 'https://evil.example/keys' } }),
        new Response('x'.repeat(64 * 1024 + 1)),
    ]) await expect(new AccessSessions({ issuer: accessIssuer, audience: accessAudience, emailDomain: 'example.com', origin },
        async () => response).require(request(await accessToken()))).rejects.toMatchObject({ status: 401 });
});

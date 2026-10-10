import { PrivateR2Bucket } from '../../src/infrastructure/storage/r2-bucket';
import { LarkAuthHttp } from '../../src/infrastructure/lark/auth-http';
import { LarkHttpClient } from '../../src/infrastructure/lark/http-client';
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { accessToken, accessIssuer, accessJwks } from '../support/access-fixture';
import { jwtVerify, createLocalJWKSet, createRemoteJWKSet } from 'jose';
import { AccessSessions } from '../../src/infrastructure/auth/access-sessions';
import worker, { type Env } from '../../src/bootstrap/worker';

const fetchService = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://service.example${path}`, { redirect: 'manual', ...init }), env as unknown as Env);

it('verifies signed Access fixtures with native cryptography and configured JWKS', async () => {
    const token = await accessToken();
    expect((await jwtVerify(token, createLocalJWKSet(accessJwks))).payload.email).toBe('admin@example.com');
    const response = await fetch(accessIssuer + '/cdn-cgi/access/certs');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(accessJwks);
    expect((await jwtVerify(token, createRemoteJWKSet(new URL(accessIssuer + '/cdn-cgi/access/certs')))).payload.email).toBe('admin@example.com');
    const access = new AccessSessions({ issuer: accessIssuer, audience: 'fixture-application-audience', emailDomain: 'example.com', origin: 'https://service.example' });
    await expect(access.require(new Request('https://service.example/api/admin/session', { headers: { 'Cf-Access-Jwt-Assertion': token } }))).resolves.toMatchObject({ email: 'admin@example.com' });
});

it('does not exchange the legacy administrator secret for a session', async () => {
    const response = await fetchService('/api/admin/login', { method: 'POST', headers: { Origin: 'https://service.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'test-secret-with-at-least-forty-three-characters' }) });
    expect(response.status).toBe(410);
    expect(response.headers.get('Set-Cookie')).toBeNull();
});

it('only redirects verified Access login to local management return paths', async () => {
    const headers = { 'Cf-Access-Jwt-Assertion': await accessToken() };
    const valid = await fetchService('/api/admin/access-login?returnTo=' + encodeURIComponent('/consent?handle=fixture'), { headers });
    expect(valid.status).toBe(302);
    expect(valid.headers.get('Location')).toBe('/consent?handle=fixture');
    for (const target of ['https://evil.example/', '//evil.example/', '/token', '/\\evil.example/']) {
        expect((await fetchService('/api/admin/access-login?returnTo=' + encodeURIComponent(target), { headers })).status).toBe(400);
    }
    expect((await fetchService('/api/admin/access-login')).status).toBe(401);
});

it('limits unauthenticated dynamic registration and classifies malformed management input', async () => {
    const register = () => fetchService('/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.2' }, body: JSON.stringify({ client_name: 'Rate limit fixture', redirect_uris: ['http://localhost:3210/callback'], token_endpoint_auth_method: 'none' }) });
    for (let i = 0; i < 10; i++) expect((await register()).status).toBe(201);
    expect((await register()).status).toBe(429);
    const invalid = await fetchService('/api/admin/login', { method: 'POST', headers: { Origin: 'https://service.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 42 }) });
    expect(invalid.status).toBe(410);
});

it('configures an isolated event inbox and verifies callback challenges', async () => {
    const headers: Record<string, string> = { Origin: 'https://service.example', 'Content-Type': 'application/json' };
    headers['Cf-Access-Jwt-Assertion'] = await accessToken();
    headers.Cookie = '';
    const session = await fetchService('/api/admin/session', { headers });
    expect(session.status).toBe(200);
    headers['X-CSRF-Token'] = (await session.json() as { csrf: string }).csrf;
    const profile = await (await fetchService('/api/admin/profiles', { method: 'POST', headers, body: JSON.stringify({ name: 'Event app', brand: 'lark', appId: 'cli_event', appSecret: 'test-secret' }) })).json() as { id: string };
    expect((await fetchService(`/api/admin/profiles/${profile.id}/events`, { method: 'PUT', headers, body: JSON.stringify({ verificationToken: 'verify-fixture', encryptKey: 'encrypt-fixture' }) })).status).toBe(200);
    const callback = (token: string) => fetchService(`/callbacks/lark/${profile.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'url_verification', token, challenge: 'challenge-fixture' }) });
    expect(await (await callback('verify-fixture')).json()).toEqual({ challenge: 'challenge-fixture' });
    expect((await callback('wrong')).status).toBe(401);
    expect(await (await fetchService(`/api/admin/profiles/${profile.id}/events`, { headers })).json()).toMatchObject({ events: [] });
    await fetchService(`/api/admin/profiles/${profile.id}`, { method: 'DELETE', headers });
    expect((await callback('verify-fixture')).status).toBe(404);
});

it('rejects oversized control-plane requests before parsing or persistence', async () => {
    const response = await fetchService('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'x'.repeat(1024 * 1024) }) });
    expect(response.status).toBe(413);
    const login = await fetchService('/api/admin/login', { method: 'POST', headers: { Origin: 'https://service.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'x'.repeat(1024 * 1024) }) });
    expect(login.status).toBe(413);
});

it('stores private artifacts with exact length and exposes persisted usage', async () => {
    const headers: Record<string, string> = { Origin: 'https://service.example', 'Content-Type': 'application/json' };
    headers['Cf-Access-Jwt-Assertion'] = await accessToken();
    headers.Cookie = '';
    const session = await fetchService('/api/admin/session', { headers });
    expect(session.status).toBe(200);
    headers['X-CSRF-Token'] = (await session.json() as { csrf: string }).csrf;
    headers['Content-Length'] = '4';
    const upload = await fetchService('/api/admin/artifacts', { method: 'POST', headers, body: 'data' });
    expect(upload.status).toBe(201);
    const file = await upload.json() as { id: string };
    const range = await new PrivateR2Bucket((env as unknown as Env).ARTIFACTS).get(file.id, { offset: 1, length: 2 });
    expect(await range!.text()).toBe('at');
    expect(range!.headers.get('Content-Length')).toBe('2');
    delete headers['Content-Length'];
    expect(await (await fetchService(`/api/admin/artifacts/${file.id}`, { headers })).text()).toBe('data');
    expect((await fetchService(`/api/admin/artifacts/${file.id}`)).status).toBe(401);
    expect(await (await fetchService('/api/admin/usage', { headers })).json()).toMatchObject({ bytes: 4 });
    expect((await fetchService(`/api/admin/artifacts/${file.id}`, { method: 'DELETE', headers })).status).toBe(200);
    expect(await (await fetchService('/api/admin/usage', { headers })).json()).toMatchObject({ bytes: 0 });
});

it('completes PKCE authorization once, enforces selection, and rejects code replay', async () => {
    const headers: Record<string, string> = { Origin: 'https://service.example', 'Content-Type': 'application/json' };
    headers['Cf-Access-Jwt-Assertion'] = await accessToken();
    headers.Cookie = '';
    const session = await fetchService('/api/admin/session', { headers });
    expect(session.status).toBe(200);
    headers['X-CSRF-Token'] = (await session.json() as { csrf: string }).csrf;
    const profile = await (await fetchService('/api/admin/profiles', { method: 'POST', headers, body: JSON.stringify({ name: 'OAuth app', brand: 'lark', appId: 'cli_oauth', appSecret: 'test-secret' }) })).json() as { id: string };
    const client = await (await fetchService('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Runtime test', redirect_uris: ['http://localhost:3210/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })).json() as { client_id: string };
    expect(client.client_id).toBeTruthy();
    const verifier = 'a'.repeat(43);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const challenge = btoa(String.fromCharCode(...digest)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'http://localhost:3210/callback', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', scope: 'mcp:read mcp:write offline_access', state: 'client-state', resource: 'https://service.example/mcp' });
    const authorization = await fetchService(`/authorize?${query}`, { headers });
    expect(authorization.status).toBe(302);
    const handle = new URL(authorization.headers.get('Location')!, 'https://service.example').searchParams.get('handle')!;
    headers.Cookie += `; ${authorization.headers.get('Set-Cookie')!.split(';')[0]}`;
    const selected = { profiles: [{ profileId: profile.id, accounts: [], identities: ['bot'] }], domains: ['calendar', 'artifact'], permissions: ['read', 'write'] };
    const approved = await fetchService(`/api/admin/consent/${handle}`, { method: 'POST', headers, body: JSON.stringify(selected) });
    expect(approved.status).toBe(200);
    const redirect = new URL((await approved.json() as { redirectTo: string }).redirectTo);
    expect(redirect.searchParams.get('state')).toBe('client-state');
    const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, code: redirect.searchParams.get('code')!, redirect_uri: 'http://localhost:3210/callback', code_verifier: verifier, resource: 'https://service.example/mcp' });
    const exchange = () => fetchService('/token', { method: 'POST', body });
    const token = await exchange();
    expect(token.status).toBe(200);
    const issued = await token.json() as { access_token: string; refresh_token: string };
    expect(issued.refresh_token).toBeTruthy();
    const artifactUpload = await fetchService('/mcp/artifacts', { method: 'POST', headers: { Authorization: `Bearer ${issued.access_token}`, 'Content-Length': '4' }, body: 'data' });
    expect(artifactUpload.status).toBe(201);
    const privateArtifact = await artifactUpload.json() as { id: string };
    expect(await (await fetchService(`/mcp/artifacts/${privateArtifact.id}`, { headers: { Authorization: `Bearer ${issued.access_token}` } })).text()).toBe('data');
    expect((await fetchService(`/mcp/artifacts/${privateArtifact.id}`)).status).toBe(401);

    const refreshed = await fetchService('/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: issued.refresh_token, scope: 'mcp:read', resource: 'https://service.example/mcp' }) });
    expect(refreshed.status).toBe(200);
    const access = (await refreshed.json() as { access_token: string }).access_token;
    expect(access).toBeTruthy();
    const deniedUpload = await fetchService('/mcp/artifacts', { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Length': '4' }, body: 'data' });
    expect(deniedUpload.status).toBe(403);
    expect(await (await fetchService(`/mcp/artifacts/${privateArtifact.id}`, { headers: { Authorization: `Bearer ${access}` } })).text()).toBe('data');

    const mcp = () => fetchService('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    const tools = await mcp();
    expect(tools.status, await tools.clone().text()).toBe(200);
    expect((await tools.json() as { result: { tools: { name: string }[] } }).result.tools.map(tool => tool.name)).toEqual(['lark_search', 'lark_schema', 'lark_execute', 'lark_auth_diagnose']);
    const writeAttempt = await fetchService('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'lark_execute', arguments: { command: 'im.+messages-send', identity: 'bot', args: { 'chat-id': 'oc_fixture', text: 'Fixture' }, dryRun: true } } }) });
    expect(writeAttempt.status).toBe(403);
    expect(writeAttempt.headers.get('WWW-Authenticate')).toContain('error="insufficient_scope"');
    expect(writeAttempt.headers.get('WWW-Authenticate')).toContain('scope="mcp:read mcp:write"');
    const searchWrite = await fetchService('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'lark_search', arguments: { query: 'im.+messages-send' } } }) });
    expect(searchWrite.status).toBe(403);
    const searchRead = await fetchService('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'lark_search', arguments: { query: 'list' } } }) });
    expect(searchRead.status).toBe(200);


    const search = await fetchService('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'lark_search', arguments: { query: '', domain: 'calendar' } } }) });
    const commands = (await search.json() as { result: { structuredContent: { commands: { risk: string }[] } } }).result.structuredContent.commands;
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every((command) => command.risk === 'read')).toBe(true);
    expect((await fetchService(`/api/admin/consent/${handle}`, { method: 'POST', headers, body: JSON.stringify(selected) })).status).not.toBe(200);
    const grants = await (await fetchService('/api/admin/grants', { headers })).json() as { items: { id: string; clientId: string }[] };
    const grant = grants.items.find((item) => item.clientId === client.client_id)!;
    expect((await fetchService(`/api/admin/grants/${grant.id}`, { method: 'DELETE', headers })).status).toBe(200);
    expect((await mcp()).status).toBe(401);
    expect((await exchange()).status).toBe(400);
});

it('challenges unauthenticated MCP clients with discoverable OAuth metadata', async () => {
    const response = await fetchService('/mcp', { method: 'POST' });
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('oauth-protected-resource');
    const metadata = await (await fetchService('/.well-known/oauth-authorization-server')).json() as Record<string, unknown>;
    expect(metadata.authorization_endpoint).toBe('https://service.example/authorize');
    expect(metadata.code_challenge_methods_supported).toContain('S256');
});

it('authenticates the administrator and persists encrypted application profiles', async () => {
    const headers: Record<string, string> = { Origin: 'https://service.example', 'Content-Type': 'application/json' };
    expect((await fetchService('/api/admin/profiles')).status).toBe(401);
    headers['Cf-Access-Jwt-Assertion'] = await accessToken();
    headers.Cookie = '';
    const session = await fetchService('/api/admin/session', { headers });
    expect(session.status).toBe(200);
    headers['X-CSRF-Token'] = (await session.json() as { csrf: string }).csrf;
    const created = await fetchService('/api/admin/profiles', { method: 'POST', headers, body: JSON.stringify({ name: 'Test app', brand: 'lark', appId: 'cli_test', appSecret: 'never-echo-me' }) });
    expect(created.status).toBe(201);
    expect(await created.text()).not.toContain('never-echo-me');
    const profiles = await fetchService('/api/admin/profiles', { headers });
    expect(await profiles.json()).toMatchObject({ profiles: expect.arrayContaining([expect.objectContaining({ appId: 'cli_test' })]) });
    expect((await fetchService('/api/admin/profiles', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': headers['Cf-Access-Jwt-Assertion']! }, body: '{}' })).status).toBe(403);
});

it('returns JSON when Durable Object startup fails outside its request handler', async () => {
    const broken = { ...env, PUBLIC_URL: 'https://service.example', AUTHORITY: {
        getByName: () => ({ fetch: async () => { throw new Error('private initialization details'); } }),
    } } as unknown as Env;
    const response = await worker.fetch(new Request('https://service.example/api/admin/session'), broken);
    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.text()).not.toContain('private initialization details');
});

it('uses the native Workers fetch binding for authorization and business APIs', async () => {
    const auth = new LarkAuthHttp();
    await expect(auth.beginDevice({ brand: 'feishu', appId: 'fixture', appSecret: 'fixture' }, ['offline_access'])).resolves.toMatchObject({ device_code: 'runtime-code' });
    await expect(new LarkHttpClient('feishu', async () => 'fixture').request({ method: 'GET', path: '/open-apis/im/v1/chats' })).resolves.toEqual({ items: [] });
});

it('rejects upstream redirects without forwarding application or user credentials', async () => {
    const auth = new LarkAuthHttp();
    await expect(auth.userInfo('feishu', 'fixture')).rejects.toMatchObject({ code: 'UPSTREAM_AUTH_ERROR' });
    await expect(new LarkHttpClient('feishu', async () => 'fixture').request({ method: 'GET', path: '/open-apis/redirect-fixture' })).rejects.toMatchObject({ code: 'UPSTREAM_HTTP_ERROR', details: { upstreamStatus: 302 } });
});

it('starts account authorization without a scope form through real runtime adapters', async () => {
    const headers: Record<string, string> = { Origin: 'https://service.example', 'Content-Type': 'application/json' };
    headers['Cf-Access-Jwt-Assertion'] = await accessToken();
    headers.Cookie = '';
    const session = await fetchService('/api/admin/session', { headers });
    expect(session.status).toBe(200);
    headers['X-CSRF-Token'] = (await session.json() as { csrf: string }).csrf;
    const created = await fetchService('/api/admin/profiles', { method: 'POST', headers, body: JSON.stringify({ name: 'Automatic scopes', brand: 'feishu', appId: 'cli_auto', appSecret: 'fixture' }) });
    const profile = await created.json() as { id: string };
    const authorization = await fetchService(`/api/admin/profiles/${profile.id}/login`, { method: 'POST', headers });
    expect(authorization.status).toBe(200);
    const flow = await authorization.json();
    expect(flow).toMatchObject({ status: 'pending', verificationUri: 'https://accounts.feishu.cn/verify' });
    expect(JSON.stringify(flow)).not.toContain('runtime-code');
});

it('advertises write support in protected-resource discovery without requiring it for reads', async () => {
    const response = await fetchService('/.well-known/oauth-protected-resource/mcp');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resource: 'https://service.example/mcp', scopes_supported: ['mcp:read', 'mcp:write'] });
});

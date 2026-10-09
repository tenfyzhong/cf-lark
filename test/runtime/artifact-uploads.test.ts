import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { accessToken } from '../support/access-fixture';
import worker, { type Env } from '../../src/bootstrap/worker';
const MiB = 1024 * 1024;
const service = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://service.example${path}`, { redirect: 'manual', ...init }), env as unknown as Env);
async function authorize(label: string) {
    const admin: Record<string, string> = { Origin: 'https://service.example', 'Content-Type': 'application/json' };
    admin['Cf-Access-Jwt-Assertion'] = await accessToken();
    admin.Cookie = '';
    const session = await service('/api/admin/session', { headers: admin });
    expect(session.status).toBe(200);
    admin['X-CSRF-Token'] = (await session.json() as { csrf: string }).csrf;
    const profileResponse = await service('/api/admin/profiles', { method: 'POST', headers: admin, body: JSON.stringify({ name: `Upload ${label}`, brand: 'lark', appId: `cli_${label}`, appSecret: 'fixture-secret' }) });
    expect(profileResponse.status).toBe(201);
    const profile = await profileResponse.json() as { id: string };
    const registered = await service('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: `Upload ${label}`, redirect_uris: ['http://localhost:3210/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
    expect(registered.status).toBe(201);
    const client = await registered.json() as { client_id: string };
    const verifier = 'v'.repeat(43);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const challenge = btoa(String.fromCharCode(...digest)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'http://localhost:3210/callback', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', scope: 'mcp:read mcp:write offline_access', resource: 'https://service.example/mcp' });
    const authorization = await service(`/authorize?${query}`, { headers: admin });
    expect(authorization.status).toBe(302);
    const handle = new URL(authorization.headers.get('Location')!, 'https://service.example').searchParams.get('handle')!;
    admin.Cookie += `; ${authorization.headers.get('Set-Cookie')!.split(';')[0]}`;
    const consent = await service(`/api/admin/consent/${handle}`, { method: 'POST', headers: admin, body: JSON.stringify({ profiles: [{ profileId: profile.id, identities: ['bot'], accounts: [] }], domains: ['artifact'], permissions: ['read', 'write'] }) });
    expect(consent.status).toBe(200);
    const redirect = new URL((await consent.json() as { redirectTo: string }).redirectTo);
    const exchange = await service('/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, code: redirect.searchParams.get('code')!, redirect_uri: 'http://localhost:3210/callback', code_verifier: verifier, resource: 'https://service.example/mcp' }) });
    expect(exchange.status).toBe(200);
    const token = await exchange.json() as { access_token: string };
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const usage = async () => (await (await service('/api/admin/usage', { headers: admin })).json() as { bytes: number }).bytes;
    return { headers, usage };
}
function bytes(size: number, value: number): ReadableStream<Uint8Array> {
    let offset = 0;
    return new ReadableStream<Uint8Array>({ pull(controller) { if (offset === size) { controller.close(); return; } const count = Math.min(MiB, size - offset); controller.enqueue(new Uint8Array(count).fill(value)); offset += count; } });
}
async function start(headers: Record<string, string>, size: number) {
    const response = await service('/mcp/artifacts/uploads', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ size }) });
    expect(response.status, await response.clone().text()).toBe(201);
    return response.json() as Promise<{ id: string; partSize: number; partCount: number; parts: number[]; status: string; size: number }>;
}
it('uploads and verifies a 65 MiB artifact using OAuth, Authority sessions and real R2', async () => {
    const owner = await authorize('large'), baseline = await owner.usage();
    const session = await start(owner.headers, 65 * MiB);
    const path = `/mcp/artifacts/uploads/${session.id}`;
    expect(session).toMatchObject({ size: 65 * MiB, partSize: 64 * MiB, partCount: 2, parts: [], status: 'uploading' });
    expect(await owner.usage()).toBe(baseline + 65 * MiB);
    const incomplete = await service(`${path}/complete`, { method: 'POST', headers: owner.headers });
    expect(incomplete.status).toBe(409);
    expect(await incomplete.json()).toMatchObject({ code: 'INCOMPLETE_UPLOAD' });
    for (const [part, size, value] of [[1, 64 * MiB, 65], [2, MiB, 90]]) {
        const response = await service(`${path}/parts/${part}`, { method: 'PUT', headers: { ...owner.headers, 'Content-Length': String(size) }, body: bytes(size!, value!) });
        expect(response.status, await response.clone().text()).toBe(200);
        expect(await response.json()).toMatchObject({ parts: part === 1 ? [1] : [1, 2], status: 'uploading' });
    }
    expect(await (await service(path, { headers: owner.headers })).json()).toMatchObject({ parts: [1, 2] });
    const complete = await service(`${path}/complete`, { method: 'POST', headers: owner.headers });
    expect(complete.status, await complete.clone().text()).toBe(200);
    expect(await complete.json()).toMatchObject({ id: session.id, size: 65 * MiB, state: 'ready' });
    expect((await service(`${path}/complete`, { method: 'POST', headers: owner.headers })).status).toBe(200);
    const download = await service(`/mcp/artifacts/${session.id}`, { headers: owner.headers });
    expect(download.status).toBe(200); expect(download.headers.get('Content-Length')).toBe(String(65 * MiB));
    const reader = download.body!.getReader(); let received = 0;
    for (;;) { const part = await reader.read(); if (part.done) break; for (let i = 0; i < part.value.length; i += 16384) expect(part.value[i]).toBe(received + i < 64 * MiB ? 65 : 90); received += part.value.length; }
    expect(received).toBe(65 * MiB);
    const range = await service(`/mcp/artifacts/${session.id}`, { headers: { ...owner.headers, Range: `bytes=${64 * MiB - 2}-${64 * MiB + 1}` } });
    expect(range.status).toBe(206); expect(range.headers.get('Content-Range')).toBe(`bytes ${64 * MiB - 2}-${64 * MiB + 1}/${65 * MiB}`);
    expect(range.headers.get('Accept-Ranges')).toBe('bytes'); expect(range.headers.get('Content-Length')).toBe('4');
    expect([...new Uint8Array(await range.arrayBuffer())]).toEqual([65, 65, 90, 90]);
    for (const header of ['bytes=-3', `bytes=${65 * MiB - 3}-`]) { const tail = await service(`/mcp/artifacts/${session.id}`, { headers: { ...owner.headers, Range: header } }); expect(tail.status).toBe(206); expect([...new Uint8Array(await tail.arrayBuffer())]).toEqual([90, 90, 90]); }
    const invalid = await service(`/mcp/artifacts/${session.id}`, { headers: { ...owner.headers, Range: `bytes=${65 * MiB}-` } });
    expect(invalid.status).toBe(416); expect(invalid.headers.get('Content-Range')).toBe(`bytes */${65 * MiB}`);
    expect((await service(`/mcp/artifacts/${session.id}`, { method: 'DELETE', headers: owner.headers })).status).toBe(200);
    expect(await owner.usage()).toBe(baseline);
}, 60000);
it('hides sessions from other OAuth grants and returns reserved quota after abort', async () => {
    const owner = await authorize('owner'), other = await authorize('other'), baseline = await owner.usage();
    const session = await start(owner.headers, 70 * MiB), path = `/mcp/artifacts/uploads/${session.id}`;
    expect((await service(path)).status).toBe(401);
    for (const [suffix, method] of [['', 'GET'], ['', 'DELETE'], ['/complete', 'POST']]) expect((await service(path + suffix, { method, headers: other.headers })).status).toBe(404);
    expect(await owner.usage()).toBe(baseline + 70 * MiB);
    expect((await service(path, { method: 'DELETE', headers: owner.headers })).status).toBe(200);
    expect((await service(path, { method: 'DELETE', headers: owner.headers })).status).toBe(200);
    expect(await owner.usage()).toBe(baseline);
    expect(await (await service(path, { headers: owner.headers })).json()).toMatchObject({ status: 'aborted' });
    expect((await service(`/mcp/artifacts/${session.id}`, { headers: owner.headers })).status).toBe(404);
});

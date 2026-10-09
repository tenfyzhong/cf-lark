import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

const origin = process.env.LARK_LIVE_URL;
const cookieFile = process.env.LARK_LIVE_ACCESS_COOKIE_FILE;

it.skipIf(!origin)('verifies public OAuth discovery and anonymous access boundaries', async () => {
    const send = (path: string, init?: RequestInit) => fetch(`${origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(30_000), ...init });
    const home = await send('/');
    expect(home.status).toBe(200);
    expect(home.headers.get('Content-Type')).toContain('text/html');
    const metadata = await send('/.well-known/oauth-authorization-server');
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({ authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token` });
    const resource = await send('/.well-known/oauth-protected-resource/mcp');
    expect(resource.status).toBe(200);
    expect(await resource.json()).toMatchObject({ resource: `${origin}/mcp` });
    const challenge = await send('/mcp', { method: 'POST' });
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get('WWW-Authenticate')).toContain(`${origin}/.well-known/oauth-protected-resource/mcp`);
    for (const path of ['/api/admin/session', '/api/admin/profiles', '/api/admin/artifacts/private-fixture']) {
        const response = await send(path);
        expect([302, 403]).toContain(response.status);
        if (response.status === 302) expect(new URL(response.headers.get('Location')!).hostname).toMatch(/\.cloudflareaccess\.com$/u);
    }
}, 120_000);

it.skipIf(!origin || !cookieFile)('verifies the deployed management boundary and private R2 lifecycle', async () => {
    const sessionCookie = JSON.parse(await readFile(cookieFile!, 'utf8')) as { cookie: string };
    const send = (path: string, init?: RequestInit) => fetch(`${origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(30_000), ...init });
    const challenge = await send('/mcp', { method: 'POST' });
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get('WWW-Authenticate')).toContain(`${origin}/.well-known/oauth-protected-resource/mcp`);
    const metadata = await send('/.well-known/oauth-authorization-server');
    expect(metadata.status).toBe(200);
    expect((await metadata.json() as { authorization_endpoint: string }).authorization_endpoint).toBe(`${origin}/authorize`);
    const headers: Record<string, string> = { Origin: origin!, 'Content-Type': 'application/json', Cookie: sessionCookie.cookie };
    const session = await send('/api/admin/session', { headers });
    expect(session.status).toBe(200);
    headers['X-CSRF-Token'] = (await session.json() as { csrf: string }).csrf;
    let artifactId: string | undefined;
    try {
        const profiles = await send('/api/admin/profiles', { headers });
        expect(profiles.status).toBe(200);
        expect(Array.isArray((await profiles.json() as { profiles: unknown[] }).profiles)).toBe(true);
        const content = 'Cloudflare acceptance fixture';
        const upload = await send('/api/admin/artifacts', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(new TextEncoder().encode(content).byteLength) }, body: content });
        expect(upload.status).toBe(201);
        artifactId = (await upload.json() as { id: string }).id;
        expect([302, 403]).toContain((await send(`/api/admin/artifacts/${artifactId}`)).status);
        const download = await send(`/api/admin/artifacts/${artifactId}`, { headers });
        expect(download.status).toBe(200);
        expect(new TextDecoder().decode(await download.arrayBuffer())).toBe(content);
        expect((await send('/api/admin/usage', { headers })).status).toBe(200);
    } finally {
        if (artifactId) expect((await send(`/api/admin/artifacts/${artifactId}`, { method: 'DELETE', headers })).status).toBe(200);
        expect((await send('/api/admin/logout', { method: 'POST', headers })).status).toBe(200);
    }
}, 120_000);

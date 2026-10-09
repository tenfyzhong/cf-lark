import { createHash } from 'node:crypto';
import { browserAccessToken } from '../support/browser-access';
import { test, expect } from '@playwright/test';

test('task and tasklist previews work through OAuth on native Wrangler', async ({ request }) => {
    const base = 'http://localhost:8787';
    const assertion = browserAccessToken();
    const session = await request.get('/api/admin/session', { headers: { 'Cf-Access-Jwt-Assertion': assertion } });
    expect(session.status()).toBe(200);
    const headers = { Origin: base, 'Cf-Access-Jwt-Assertion': assertion, 'X-CSRF-Token': (await session.json()).csrf };
    const profile = await (await request.post('/api/admin/profiles', { headers, data: {
        name: 'Task validation fixture', brand: 'lark', appId: 'cli_validation', appSecret: 'test-only',
    } })).json();
    const client = await (await request.post('/register', { data: {
        client_name: 'Task preview fixture', redirect_uris: ['http://localhost:3210/callback'],
        token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'],
    } })).json();
    const verifier = 'v'.repeat(43);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorize = await request.get('/authorize?' + new URLSearchParams({
        client_id: client.client_id, redirect_uri: 'http://localhost:3210/callback', response_type: 'code',
        scope: 'mcp:read', code_challenge: challenge, code_challenge_method: 'S256', resource: base + '/mcp',
    }), { maxRedirects: 0 });
    const handle = new URL(authorize.headers().location!, base).searchParams.get('handle')!;
    const consent = await request.post('/api/admin/consent/' + handle, { headers, data: {
        profiles: [{ profileId: profile.id, accounts: [], identities: ['bot'] }], domains: ['task'], permissions: ['read'],
    } });
    const code = new URL((await consent.json()).redirectTo).searchParams.get('code')!;
    const token = await request.post('/token', { form: {
        grant_type: 'authorization_code', client_id: client.client_id, code,
        code_verifier: verifier, redirect_uri: 'http://localhost:3210/callback', resource: base + '/mcp',
    } });
    expect(token.status()).toBe(200);
    const access = (await token.json()).access_token;
    try {
        for (const command of ['task.tasks.list', 'task.tasklists.list']) {
            const response = await request.post('/mcp', {
                headers: { Authorization: 'Bearer ' + access, Accept: 'application/json, text/event-stream' },
                data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lark_execute', arguments: {
                    command, args: { params: { page_size: 20 } }, identity: 'bot', dryRun: true,
                } } },
            });
            const body = await response.json();
            expect(body.result?.isError, JSON.stringify(body)).not.toBe(true);
            expect(body.result?.structuredContent).toMatchObject({ ok: true, data: { method: 'GET', query: { page_size: 20 } } });
        }
    } finally {
        await request.delete('/api/admin/profiles/' + profile.id, { headers });
    }
});

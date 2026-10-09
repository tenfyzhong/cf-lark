import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { prepareDeployment } from '../scripts/deploy/bootstrap';
const templates = await Promise.all(['wrangler.jsonc', 'wrangler.engine-docs.jsonc', 'wrangler.engine-mail.jsonc'].map(async (file) => JSON.parse(await readFile(file, 'utf8'))));
const account = 'a'.repeat(32), audience = 'b'.repeat(64);
const env = { PUBLIC_URL: 'https://mcp.acme.test', ACCESS_EMAIL_DOMAIN: 'acme.test',
    CLOUDFLARE_API_TOKEN: 'test-only-token', ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') };
const policy = { name: 'cf-lark-administrators', decision: 'allow', include: [{ email_domain: { domain: 'acme.test' } }], require: [], exclude: [] };
const app = { id: 'app-id', aud: audience, name: 'cf-lark-management', type: 'self_hosted', domain: 'mcp.acme.test/api/admin',
    destinations: [{ type: 'public', uri: 'mcp.acme.test/api/admin' }, { type: 'public', uri: 'mcp.acme.test/consent' }],
    allowed_idps: ['pin-id'], session_duration: '8h', allow_authenticate_via_warp: false };
function fixture(options: { create?: boolean; unsafe?: boolean; ambiguous?: boolean; missingPolicy?: boolean; badIssuer?: boolean } = {}) {
    const apps: Record<string, unknown>[] = options.create ? [] : [options.unsafe ? { ...app, destinations: [{ type: 'public', uri: 'mcp.acme.test' }] } : app];
    let org = !options.create, pin = !options.create;
    let policies = options.missingPolicy ? [] : [policy];
    return vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname;
        const body = init.body ? JSON.parse(String(init.body)) : {};
        let result: unknown;
        if (path === '/client/v4/zones') result = new URL(url).searchParams.get('name') === 'acme.test'
            ? (options.ambiguous ? [{ status: 'active', account: { id: account } }, { status: 'active', account: { id: 'c'.repeat(32) } }]
                : [{ status: 'active', account: { id: account } }]) : [];
        else if (path.endsWith('/access/organizations')) {
            if (init.method === 'POST') org = true;
            if (!org) return Response.json({ success: false }, { status: 404 });
            result = { auth_domain: options.badIssuer ? 'untrusted.test' : 'acme.cloudflareaccess.com' };
        } else if (path.endsWith('/identity_providers')) {
            if (init.method === 'POST') { pin = true; result = { id: 'pin-id', type: 'onetimepin' }; }
            else result = pin ? [{ id: 'pin-id', type: 'onetimepin' }] : [];
        } else if (path.endsWith('/apps')) {
            if (init.method === 'POST') { apps.push({ ...body, id: app.id, aud: audience }); result = apps[0]; }
            else result = apps;
        } else if (path.endsWith('/apps/app-id')) result = apps[0];
        else if (path.endsWith('/apps/app-id/policies')) {
            if (init.method === 'POST') { policies = [body]; result = body; } else result = policies;
        } else throw new Error('Unexpected fixture endpoint');
        return Response.json({ success: true, result });
    });
}

it('derives account/team/AUD from four Secrets and preserves encryption and quota', async () => {
    const request = fixture();
    const rendered = await prepareDeployment(env, templates, request);
    expect(rendered.configs[0]).toMatchObject({ account_id: account, vars: { ACCESS_TEAM_DOMAIN: 'https://acme.cloudflareaccess.com', ACCESS_AUD: audience, MAX_STORAGE_BYTES: '2000000000' } });
    expect(rendered.secrets.ENCRYPTION_KEY).toBe(env.ENCRYPTION_KEY);
    expect(request.mock.calls.every((call) => call[1].method === 'GET')).toBe(true);
});

it('creates organization/PIN/application with narrow domains and email policy', async () => {
    const request = fixture({ create: true });
    await prepareDeployment(env, templates, request);
    const writes = request.mock.calls.filter((call) => call[1].method === 'POST');
    expect(writes).toHaveLength(3);
    expect(JSON.parse(String(writes[0]![1].body))).toMatchObject({ auth_domain: `cf-lark-${account}.cloudflareaccess.com` });
    expect(JSON.parse(String(writes[1]![1].body))).toMatchObject({ type: 'onetimepin' });
    expect(JSON.parse(String(writes[2]![1].body))).toMatchObject({ destinations: app.destinations, allowed_idps: ['pin-id'], policies: [policy] });
});

it('repairs only a missing policy on an otherwise safe dedicated application', async () => {
    const request = fixture({ missingPolicy: true });
    await prepareDeployment(env, templates, request);
    expect(request.mock.calls.filter((call) => call[1].method === 'POST')).toHaveLength(1);
});

it('preserves complete manual Access overrides without making API requests', async () => {
    const request = vi.fn();
    const rendered = await prepareDeployment({ ...env, CLOUDFLARE_ACCOUNT_ID: account,
        ACCESS_TEAM_DOMAIN: 'https://manual.cloudflareaccess.com', ACCESS_AUD: audience }, templates, request);
    expect(rendered.configs[0]?.account_id).toBe(account);
    expect(request).not.toHaveBeenCalled();
});

for (const options of [{ unsafe: true }, { ambiguous: true }, { badIssuer: true }]) it(`fails closed for unsafe discovery ${JSON.stringify(options)}`, async () => {
    const request = fixture(options);
    await expect(prepareDeployment(env, templates, request)).rejects.toThrow();
    expect(request.mock.calls.every((call) => call[1].method === 'GET')).toBe(true);
});

it('validates inputs before provisioning resources', async () => {
    for (const override of [{ PUBLIC_URL: 'http://mcp.acme.test' }, { ENCRYPTION_KEY: '' }, { ACCESS_EMAIL_DOMAIN: '' }]) {
        const request = vi.fn();
        await expect(prepareDeployment({ ...env, ...override }, templates, request)).rejects.toThrow();
        expect(request).not.toHaveBeenCalled();
    }
});

it('sanitizes upstream and transport errors', async () => {
    for (const request of [vi.fn().mockResolvedValue(Response.json({ success: false, errors: [{ message: env.CLOUDFLARE_API_TOKEN }] }, { status: 403 })), vi.fn().mockRejectedValue(new Error(env.CLOUDFLARE_API_TOKEN))]) {
        await expect(prepareDeployment(env, templates, request)).rejects.toThrow('Cloudflare bootstrap request failed');
    }
});

it('bounds paginated discovery and refuses incomplete inventories', async () => {
    const request = vi.fn().mockImplementation(async () => Response.json({ success: true, result: [], result_info: { total_pages: 100 } }));
    await expect(prepareDeployment(env, templates, request)).rejects.toThrow('Cloudflare bootstrap inventory exceeds limit');
    expect(request).toHaveBeenCalledTimes(20);
});

it('derives only the account when both manual Access overrides are provided', async () => {
    const request = fixture();
    await prepareDeployment({ ...env, ACCESS_TEAM_DOMAIN: 'https://manual.cloudflareaccess.com', ACCESS_AUD: audience }, templates, request);
    expect(request.mock.calls.every((call) => new URL(call[0]).pathname === '/client/v4/zones')).toBe(true);
});

it('does not overwrite an existing broad policy or an unexpected identity provider', async () => {
    for (const change of ['policy', 'provider']) {
        const original = fixture();
        const request = vi.fn(async (url: string, init: RequestInit) => {
            if (change === 'policy' && new URL(url).pathname.endsWith('/policies')) {
                return Response.json({ success: true, result: [{ ...policy, include: [{ everyone: {} }] }] });
            }
            if (change === 'provider' && new URL(url).pathname.endsWith('/apps/app-id')) {
                return Response.json({ success: true, result: { ...app, allowed_idps: [] } });
            }
            return original(url, init);
        });
        await expect(prepareDeployment(env, templates, request)).rejects.toThrow('Unsafe');
        expect(request.mock.calls.every((call) => call[1].method === 'GET')).toBe(true);
    }
});

it('fails on absent zones without creating resources', async () => {
    const request = vi.fn(async () => Response.json({ success: true, result: [] }));
    await expect(prepareDeployment(env, templates, request)).rejects.toThrow('No active Cloudflare zone');
    expect(request).toHaveBeenCalledTimes(2);
});

it('fails when an explicit audience does not match the discovered application', async () => {
    const request = fixture();
    await expect(prepareDeployment({ ...env, ACCESS_AUD: 'c'.repeat(64) }, templates, request)).rejects.toThrow('mismatched ACCESS_AUD');
    expect(request.mock.calls.every((call) => call[1].method === 'GET')).toBe(true);
});

it('does not assume a full inventory when pagination metadata is omitted', async () => {
    const request = vi.fn(async () => Response.json({ success: true, result: Array.from({ length: 50 }, () => ({ status: 'inactive' })) }));
    await expect(prepareDeployment(env, templates, request)).rejects.toThrow('Cloudflare bootstrap inventory exceeds limit');
    expect(request).toHaveBeenCalledTimes(20);
});

it('rejects policies that extend the documented eight-hour management session', async () => {
    const original = fixture();
    const request = vi.fn(async (url: string, init: RequestInit) => new URL(url).pathname.endsWith('/policies')
        ? Response.json({ success: true, result: [{ ...policy, session_duration: '24h' }] }) : original(url, init));
    await expect(prepareDeployment(env, templates, request)).rejects.toThrow('Unsafe');
    expect(request.mock.calls.every((call) => call[1].method === 'GET')).toBe(true);
});

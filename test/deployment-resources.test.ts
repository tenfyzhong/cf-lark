import { expect, it, vi } from 'vitest';
import { discoverResources } from '../scripts/deploy/resources';
import { CloudflareBootstrapClient } from '../scripts/deploy/cloudflare';
const account = 'a'.repeat(32), origin = 'https://mcp.acme.test';
const bindings = (worker: string, bucket: string, publicUrl = origin) => [
    { name: 'PUBLIC_URL', type: 'plain_text', text: publicUrl },
    { name: 'AUTHORITY', type: 'durable_object_namespace', class_name: 'Authority', namespace_id: 'c'.repeat(32) },
    { name: 'EVENT_INBOX', type: 'durable_object_namespace', class_name: 'EventInbox', namespace_id: 'd'.repeat(32) },
    { name: 'ARTIFACTS', type: 'r2_bucket', bucket_name: bucket },
    { name: 'DOCS_ENGINE', type: 'service', service: worker + '-docs-engine' },
    { name: 'MAIL_ENGINE', type: 'service', service: worker + '-mail-engine' },
];
function fixture(domains: unknown[], scripts: Record<string, unknown>) {
    return vi.fn(async (url: string, init: RequestInit) => {
        expect(init.method).toBe('GET');
        const path = new URL(url).pathname;
        if (path.endsWith('/workers/domains')) return Response.json({ success: true, result: domains });
        const worker = path.match(/\/scripts\/([^/]+)\/settings$/u)?.[1];
        if (!worker) throw new Error('Unexpected endpoint');
        if (!(worker in scripts)) return Response.json({ success: false }, { status: 404 });
        return Response.json({ success: true, result: scripts[worker] });
    });
}
const client = (request: ReturnType<typeof fixture>) => new CloudflareBootstrapClient('test-token', request);
it('retains a custom Worker and its original private bucket from the hostname binding', async () => {
    const request = fixture([{ hostname: 'mcp.acme.test', service: 'team-lark', environment: 'production' }], {
        'team-lark': { bindings: bindings('team-lark', 'existing-artifacts') },
    });
    await expect(discoverResources(client(request), account, origin)).resolves.toEqual({ worker: 'team-lark', bucket: 'existing-artifacts' });
});
it('uses default names for a fresh installation', async () => {
    await expect(discoverResources(client(fixture([], {})), account, origin)).resolves.toEqual({ worker: 'cf-lark', bucket: 'cf-lark-private' });
});
it('recovers a partially uploaded installation before its domain was attached', async () => {
    await expect(discoverResources(client(fixture([], { 'cf-lark': { bindings: bindings('cf-lark', 'existing-artifacts') } })), account, origin))
        .resolves.toEqual({ worker: 'cf-lark', bucket: 'existing-artifacts' });
});
it('uses a selected Worker namespace and derives its new private bucket', async () => {
    await expect(discoverResources(client(fixture([], {})), account, origin, 'team-lark')).resolves.toEqual({ worker: 'team-lark', bucket: 'team-lark-private' });
});
it('refuses to overwrite a Worker owned by another hostname', async () => {
    const request = fixture([], { 'cf-lark': { bindings: bindings('cf-lark', 'other-bucket', 'https://other.acme.test') } });
    await expect(discoverResources(client(request), account, origin)).rejects.toThrow();
});
it('refuses to switch an existing hostname to a different explicit Worker', async () => {
    const request = fixture([{ hostname: 'mcp.acme.test', service: 'team-lark' }], {});
    await expect(discoverResources(client(request), account, origin, 'other-lark')).rejects.toThrow();
});

for (const domains of [
    [{ hostname: 'mcp.acme.test', service: 'team-lark' }, { hostname: 'mcp.acme.test', service: 'other-lark' }],
    [{ hostname: 'mcp.acme.test', service: 'unsafe/worker' }],
    [{ hostname: 'mcp.acme.test', service: 'team-lark', environment: 'staging' }],
]) it('rejects ambiguous/unsafe domain identities', async () => {
    await expect(discoverResources(client(fixture(domains, {})), account, origin)).rejects.toThrow();
});
for (const entries of [[], bindings('team-lark', 'original').filter((entry) => entry.name !== 'AUTHORITY'),
    [...bindings('team-lark', 'original'), { name: 'ARTIFACTS', type: 'r2_bucket', bucket_name: 'other' }],
    bindings('team-lark', 'original', 'https://unrelated.acme.test'),
    bindings('team-lark', 'INVALID_BUCKET'),
]) it('fails instead of abandoning a deployed bucket or overwriting unrelated resources', async () => {
    const request = fixture([{ hostname: 'mcp.acme.test', service: 'team-lark' }], { 'team-lark': { bindings: entries } });
    await expect(discoverResources(client(request), account, origin)).rejects.toThrow();
});
it('fails if a bound Worker cannot be read', async () => {
    await expect(discoverResources(client(fixture([{ hostname: 'mcp.acme.test', service: 'team-lark' }], {})), account, origin)).rejects.toThrow();
});

import { expect, it, vi } from 'vitest';
import { artifactResponse } from '../src/adapters/http/artifacts';
import type { Grant } from '../src/domain/models';

const grant: Grant = { id: 'grant-fixture', revoked: false, expiresAt: Date.now() + 100_000,
    profiles: [], domains: ['artifact'], permissions: ['read', 'write'] };
const setup = () => ({ upload: vi.fn(async () => ({ id: 'file-id', owner: grant.id, size: 4, expiresAt: grant.expiresAt, state: 'ready' as const })),
    read: vi.fn(async () => new Response('data')), remove: vi.fn(async () => {}) });
it('streams uploads and uses the authenticated grant as owner', async () => {
    const store = setup();
    const response = await artifactResponse(new Request('https://service.example/mcp/artifacts', {
        method: 'POST', headers: { 'Content-Length': '4' }, body: 'data',
    }), grant, store);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: 'file-id', size: 4 });
    expect(store.upload).toHaveBeenCalledWith(grant.id, 4, expect.any(ReadableStream));
});
it('reads and deletes only within the grant namespace', async () => {
    const store = setup();
    expect(await (await artifactResponse(new Request('https://service.example/mcp/artifacts/file-id'), grant, store)).text()).toBe('data');
    expect(store.read).toHaveBeenCalledWith(grant.id, 'file-id');
    expect((await artifactResponse(new Request('https://service.example/mcp/artifacts/file-id', { method: 'DELETE' }), grant, store)).status).toBe(200);
    expect(store.remove).toHaveBeenCalledWith(grant.id, 'file-id');
});
it.each([
    { ...grant, domains: ['docs'] }, { ...grant, permissions: ['read'] }, { ...grant, revoked: true }, { ...grant, expiresAt: 0 },
])('rejects unauthorized upload before storage access', async (denied) => {
    const store = setup();
    const response = await artifactResponse(new Request('https://service.example/mcp/artifacts', { method: 'POST', headers: { 'Content-Length': '4' }, body: 'data' }), denied as Grant, store);
    expect([401, 403]).toContain(response.status);
    expect(store.upload).not.toHaveBeenCalled();
});
it('rejects unknown sizes and routes without consuming storage', async () => {
    const store = setup();
    expect((await artifactResponse(new Request('https://service.example/mcp/artifacts', { method: 'POST', body: 'data' }), grant, store)).status).toBe(411);
    expect((await artifactResponse(new Request('https://service.example/mcp/artifacts/a/b'), grant, store)).status).toBe(404);
    expect(store.upload).not.toHaveBeenCalled();
    expect(store.read).not.toHaveBeenCalled();
});
it('returns asynchronous storage failures as JSON without leaking internal errors', async () => {
    const store = setup();
    store.read.mockRejectedValueOnce(new Error('Private storage failure'));
    const response = await artifactResponse(new Request('https://service.example/mcp/artifacts/file-id'), grant, store);
    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.text()).not.toContain('Private storage failure');
});
it('accepts an explicit zero Content-Length without treating a missing header as empty', async () => {
    const store = setup(); store.upload.mockResolvedValueOnce({ id: 'empty', owner: grant.id, size: 0, expiresAt: grant.expiresAt, state: 'ready' });
    const response = await artifactResponse(new Request('https://service.example/mcp/artifacts', { method: 'POST', headers: { 'Content-Length': '0' } }), grant, store);
    expect(response.status).toBe(201);
    expect(store.upload).toHaveBeenCalledWith(grant.id, 0, expect.any(ReadableStream));
});

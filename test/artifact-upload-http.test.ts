import { expect, it, vi } from 'vitest';
import { artifactResponse } from '../src/adapters/http/artifacts';
import type { Grant } from '../src/domain/models';
const grant: Grant = { id: 'owner', domains: ['artifact'], permissions: ['read', 'write'], profiles: [], expiresAt: Date.now() + 100000, revoked: false };
function fixture() { return { upload: vi.fn(), read: vi.fn(), remove: vi.fn(), beginUpload: vi.fn().mockResolvedValue({ id: 'id', size: 123 }), getUpload: vi.fn().mockResolvedValue({ id: 'id', parts: [1] }), uploadPart: vi.fn().mockResolvedValue({ parts: [1] }), completeUpload: vi.fn().mockResolvedValue({ id: 'id', size: 123, state: 'ready' }), abortUpload: vi.fn() }; }
const request = (path: string, method = 'GET', body?: string) => new Request(`https://service.example/mcp/artifacts/uploads${path}`, { method, ...(body === undefined ? {} : { body, headers: { 'Content-Length': String(body.length) } }) });
it('creates and inspects sessions in the authenticated owner namespace', async () => {
    const store = fixture();
    const create = await artifactResponse(request('', 'POST', '{"size":123}'), grant, store);
    expect(create.status).toBe(201); expect(store.beginUpload).toHaveBeenCalledExactlyOnceWith('owner', 123);
    expect((await artifactResponse(request('/id'), { ...grant, permissions: ['read'] }, store)).status).toBe(200);
    expect(store.getUpload).toHaveBeenCalledExactlyOnceWith('owner', 'id');
});
it('routes parts, completion and abort with exact lengths', async () => {
    const store = fixture();
    expect((await artifactResponse(request('/id/parts/1', 'PUT', 'bytes'), grant, store)).status).toBe(200);
    expect(store.uploadPart).toHaveBeenCalledWith('owner', 'id', 1, 5, expect.any(ReadableStream));
    expect((await artifactResponse(request('/id/complete', 'POST'), grant, store)).status).toBe(200);
    expect(store.completeUpload).toHaveBeenCalledExactlyOnceWith('owner', 'id');
    expect((await artifactResponse(request('/id', 'DELETE'), grant, store)).status).toBe(200);
    expect(store.abortUpload).toHaveBeenCalledExactlyOnceWith('owner', 'id');
});
it('requires write grants for all mutation routes before accessing storage', async () => {
    const store = fixture();
    for (const [path, method] of [['', 'POST'], ['/id/parts/1', 'PUT'], ['/id/complete', 'POST'], ['/id', 'DELETE']]) expect((await artifactResponse(request(path!, method!, method === 'PUT' ? 'bytes' : undefined), { ...grant, permissions: ['read'] }, store)).status).toBe(403);
    expect(store.beginUpload).not.toHaveBeenCalled(); expect(store.uploadPart).not.toHaveBeenCalled(); expect(store.completeUpload).not.toHaveBeenCalled(); expect(store.abortUpload).not.toHaveBeenCalled();
});
it('rejects malformed create JSON, absent part length and oversized parts before IO', async () => {
    const store = fixture();
    expect((await artifactResponse(request('', 'POST', '{bad'), grant, store)).status).toBe(400);
    const missing = new Request('https://service.example/mcp/artifacts/uploads/id/parts/1', { method: 'PUT', body: 'bytes' });
    expect((await artifactResponse(missing, grant, store)).status).toBe(411);
    const large = new Request('https://service.example/mcp/artifacts/uploads/id/parts/1', { method: 'PUT', body: 'bytes', headers: { 'Content-Length': String(65 * 1024 * 1024) } });
    expect((await artifactResponse(large, grant, store)).status).toBe(413);
    expect(store.uploadPart).not.toHaveBeenCalled(); expect(store.beginUpload).not.toHaveBeenCalled();
});

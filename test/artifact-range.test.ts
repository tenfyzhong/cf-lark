import { expect, it, vi } from 'vitest';
import { artifactResponse } from '../src/adapters/http/artifacts';
import { ServiceError } from '../src/domain/errors';
import type { Grant } from '../src/domain/models';
const grant: Grant = { id: 'owner', revoked: false, expiresAt: Date.now() + 60000, profiles: [], domains: ['artifact'], permissions: ['read'] };
const request = (range?: string, extra: Record<string, string> = {}) => new Request('https://service.example/mcp/artifacts/id', { headers: { ...(range === undefined ? {} : { Range: range }), ...extra } });
function setup() { return { stat: vi.fn(async () => ({ id: 'id', owner: 'owner', size: 10, expiresAt: 9, state: 'ready' as const })), read: vi.fn(async (_owner: string, _id: string, range?: { offset: number; length: number }) => new Response(range ? '0123456789'.slice(range.offset, range.offset + range.length) : '0123456789', { headers: { 'Content-Type': 'application/octet-stream', ETag: '"fixture"' } })), upload: vi.fn(), remove: vi.fn() }; }
it.each([['bytes=2-5', 2, 4], ['bytes=7-', 7, 3], ['bytes=-4', 6, 4], ['bytes=8-99', 8, 2], ['bytes=-99', 0, 10]])('returns a bounded partial response for %s', async (range, offset, length) => {
    const store = setup(); const response = await artifactResponse(request(String(range)), grant, store);
    expect(response.status).toBe(206); expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Range')).toBe(`bytes ${offset}-${Number(offset) + Number(length) - 1}/10`);
    expect(response.headers.get('Content-Length')).toBe(String(length));
    expect(store.stat).toHaveBeenCalledWith('owner', 'id');
    expect(store.read).toHaveBeenCalledWith('owner', 'id', { offset, length });
    expect(await response.text()).toBe('0123456789'.slice(Number(offset), Number(offset) + Number(length)));
});
it.each(['bytes=20-', 'bytes=8-2', 'bytes=-0', 'bytes=0-1,3-4', 'items=1-2', 'bytes=-', 'bytes=9007199254740993-'])('rejects invalid or unsatisfiable %s without reading bytes', async range => {
    const store = setup(); const response = await artifactResponse(request(range), grant, store);
    expect(response.status).toBe(416); expect(response.headers.get('Content-Range')).toBe('bytes */10'); expect(store.read).not.toHaveBeenCalled();
});
it('does not expose another owner size through invalid ranges', async () => {
    const store = setup(); store.stat.mockRejectedValueOnce(new ServiceError('ARTIFACT_NOT_FOUND', 'Unavailable.', 404));
    const response = await artifactResponse(request('bytes=999-'), grant, store);
    expect(response.status).toBe(404); expect(response.headers.has('Content-Range')).toBe(false); expect(store.read).not.toHaveBeenCalled();
});
it('preserves full bodies and conservatively ignores conditional ranges', async () => {
    const store = setup();
    for (const input of [request(), request('bytes=1-2', { 'If-Range': '"old"' })]) { const response = await artifactResponse(input, grant, store); expect(response.status).toBe(200); expect(await response.text()).toBe('0123456789'); expect(response.headers.get('Accept-Ranges')).toBe('bytes'); }
});

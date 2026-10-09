import { expect, it, vi } from 'vitest';
import { verifyDeployment } from '../scripts/deploy/smoke';
const origin = 'https://mcp.acme.test';
function fixture(bad?: string) {
    return vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        if (path === bad) return Response.json({ issuer: 'https://untrusted.test' });
        if (path === '/.well-known/oauth-authorization-server') return Response.json({ issuer: origin, authorization_endpoint: origin + '/authorize', token_endpoint: origin + '/token' });
        if (path === '/.well-known/oauth-protected-resource/mcp') return Response.json({ resource: origin + '/mcp', authorization_servers: [origin] });
        if (path === '/mcp') return new Response(null, { status: 401, headers: { 'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` } });
        if (path === '/api/admin/session') return new Response(null, { status: 302, headers: { Location: 'https://acme.cloudflareaccess.com/cdn-cgi/access/login' } });
        throw new Error('Unexpected endpoint');
    });
}
it('checks anonymous public discovery and auth challenges without following login redirects', async () => {
    const request = fixture();
    await verifyDeployment(origin, request);
    expect(request).toHaveBeenCalledTimes(4);
    for (const call of request.mock.calls as unknown as [string, RequestInit][]) {
        expect(call[1].redirect).toBe('manual');
        expect(call[1].headers).toBeUndefined();
        expect(call[1].signal).toBeInstanceOf(AbortSignal);
    }
});
for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp', '/mcp', '/api/admin/session']) {
    it(`rejects unsafe public release behavior at ${path}`, async () => {
        await expect(verifyDeployment(origin, fixture(path))).rejects.toThrow('Deployment smoke checks failed');
    });
}
it('sanitizes transport errors', async () => {
    await expect(verifyDeployment(origin, vi.fn().mockRejectedValue(new Error('private data')))).rejects.toThrow('Deployment smoke checks failed');
});

it('requires an edge Access challenge rather than an unprotected Worker login response', async () => {
    const original = fixture();
    const request = vi.fn(async (url: string) => url.endsWith('/api/admin/session')
        ? new Response(null, { status: 401 }) : original(url));
    await expect(verifyDeployment(origin, request)).rejects.toThrow('Deployment smoke checks failed');
});

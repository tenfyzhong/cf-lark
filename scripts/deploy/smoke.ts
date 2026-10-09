import type { CloudflareRequest } from './cloudflare.ts';

export async function verifyDeployment(origin: string, request: CloudflareRequest = fetch): Promise<void> {
    try {
        const paths = ['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp', '/mcp', '/api/admin/session'];
        const [authorization, resource, mcp, management] = await Promise.all(paths.map((path) => request(origin + path, {
            method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15_000),
        })));
        if (authorization!.status !== 200 || resource!.status !== 200) throw new Error();
        const auth = await authorization!.json() as Record<string, unknown>;
        const metadata = await resource!.json() as Record<string, unknown>;
        if (auth.issuer !== origin || auth.authorization_endpoint !== origin + '/authorize' || auth.token_endpoint !== origin + '/token'
            || metadata.resource !== origin + '/mcp' || !Array.isArray(metadata.authorization_servers) || !metadata.authorization_servers.includes(origin)
            || mcp!.status !== 401 || !mcp!.headers.get('WWW-Authenticate')?.includes(origin + '/.well-known/oauth-protected-resource/mcp')) throw new Error();
        if (![302, 403].includes(management!.status)) throw new Error();
        if (management!.status === 302) {
            const location = new URL(management!.headers.get('Location')!);
            if (location.protocol !== 'https:' || !/^[a-z0-9-]+\.cloudflareaccess\.com$/u.test(location.hostname)) throw new Error();
        }
    } catch { throw new Error('Deployment smoke checks failed'); }
}

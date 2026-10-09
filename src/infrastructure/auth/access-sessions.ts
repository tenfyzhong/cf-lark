import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { ServiceError } from '../../domain/errors';
import { hash } from '../crypto/secret-box';
import type { ManagementSessions } from '../../ports/admin';

interface AccessConfiguration { issuer: string; audience: string; emailDomain: string; origin: string }
const loopback = (url: URL) => url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

export class AccessSessions implements ManagementSessions {
    private readonly keys: ReturnType<typeof createRemoteJWKSet>;

    constructor(private readonly config: AccessConfiguration, fetcher: typeof fetch = (input, init) => fetch(input, init)) {
        const issuer = new URL(config.issuer);
        const origin = new URL(config.origin);
        const publicTeam = issuer.protocol === 'https:' && /^[a-z0-9-]+\.cloudflareaccess\.com$/u.test(issuer.hostname);
        if ((!publicTeam && !(loopback(issuer) && loopback(origin))) || issuer.origin !== config.issuer
            || !config.audience || !/^[a-z0-9.-]+$/u.test(config.emailDomain)) {
            throw new ServiceError('INVALID_CONFIGURATION', 'Cloudflare Access configuration is invalid.', 500);
        }
        this.keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer), {
            timeoutDuration: 5000, cacheMaxAge: 600_000, cooldownDuration: 30_000,
            [customFetch]: async (url, init) => {
                const response = await fetcher(String(url), { ...init, redirect: 'manual', signal: AbortSignal.timeout(5000) });
                if (!response.ok || !response.body) throw new Error('Access key service unavailable.');
                const reader = response.body.getReader();
                const chunks: Uint8Array[] = [];
                let bytes = 0;
                try {
                    while (true) {
                        const chunk = await reader.read();
                        if (chunk.done) break;
                        bytes += chunk.value.byteLength;
                        if (bytes > 64 * 1024) throw new Error('Access key response exceeds its limit.');
                        chunks.push(chunk.value);
                    }
                } finally { await reader.cancel(); }
                const body = new Uint8Array(bytes);
                let offset = 0;
                for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
                return new Response(body, { headers: { 'Content-Type': 'application/json' } });
            },
        });
    }

    async require(request: Request): Promise<{ csrf: string; email: string }> {
        const token = request.headers.get('Cf-Access-Jwt-Assertion');
        if (!token || token.length > 32 * 1024) throw this.unauthorized();
        let email: string;
        try {
            const { payload } = await jwtVerify(token, this.keys, {
                issuer: this.config.issuer, audience: this.config.audience, algorithms: ['RS256'],
                requiredClaims: ['exp', 'iat', 'sub', 'email'],
            });
            if (typeof payload.email !== 'string' || payload.email.length > 254 || /\s/u.test(payload.email)
                || !payload.sub || typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 60) throw this.unauthorized();
            const parts = payload.email.split('@');
            if (parts.length !== 2 || !parts[0] || parts[1]?.toLowerCase() !== this.config.emailDomain) throw this.unauthorized();
            email = payload.email;
        } catch { throw this.unauthorized(); }
        const csrf = await hash(`access-csrf:${token}`);
        if (!['GET', 'HEAD'].includes(request.method)) {
            if (request.headers.get('Origin') !== this.config.origin) throw new ServiceError('INVALID_ORIGIN', 'The request origin is not trusted.', 403);
            if (request.headers.get('X-CSRF-Token') !== csrf) throw new ServiceError('INVALID_CSRF', 'Invalid CSRF token.', 403);
        }
        return { csrf, email };
    }

    async logout(request: Request) {
        await this.require(request);
        return '__Host-lark-admin=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0';
    }

    private unauthorized() {
        return new ServiceError('UNAUTHORIZED', 'Cloudflare Access login with an authorized email is required.', 401);
    }
}

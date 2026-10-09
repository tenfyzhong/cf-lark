import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { accessAudience, accessIssuer, accessJwks } from './test/support/access-fixture';

export default defineConfig({
    plugins: [cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: { serviceBindings: { DOCS_ENGINE: async () => Response.json({ code: 'ENGINE_UNAVAILABLE', message: 'Use the dedicated engine runtime fixtures.' }, { status: 503 }), MAIL_ENGINE: async () => Response.json({ code: 'ENGINE_UNAVAILABLE', message: 'Use the dedicated engine runtime fixtures.' }, { status: 503 }) }, outboundService: async (request) => {
            const path = new URL(request.url).pathname;
            if (request.url === accessIssuer + '/cdn-cgi/access/certs') return Response.json(accessJwks);
            if (path === '/open-apis/auth/v3/tenant_access_token/internal') return Response.json({ tenant_access_token: 'runtime-tenant', expire: 7200 });
            if (path === '/open-apis/application/v6/applications/cli_auto') return Response.json({ code: 0, data: { app: { scopes: [
                { scope: 'docs:read', token_types: ['user'] }, { scope: 'bot:only', token_types: ['tenant'] },
            ] } } });
            if (path === '/oauth/v1/device_authorization') {
                const form = new URLSearchParams(await request.text());
                if (form.get('client_id') === 'cli_auto' && form.get('scope') !== 'docs:read offline_access') throw new Error('Unexpected discovered scopes');
                return Response.json({ device_code: 'runtime-code', verification_uri: 'https://accounts.feishu.cn/verify', expires_in: 600, interval: 5 });
            }
            if (new URL(request.url).pathname === '/open-apis/im/v1/chats') return Response.json({ code: 0, data: { items: [] } });
            if (['/open-apis/authen/v1/user_info', '/open-apis/redirect-fixture'].includes(new URL(request.url).pathname)) {
                return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/collect' } });
            }
            throw new Error('Unexpected outbound request in runtime test');
        }, bindings: {
            PUBLIC_URL: 'https://service.example',
            ACCESS_TEAM_DOMAIN: accessIssuer,
            ACCESS_AUD: accessAudience,
            ACCESS_EMAIL_DOMAIN: 'tenfy.cn',
            ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        } },
    })],
    test: { include: ['test/runtime/**/*.test.ts'] },
});

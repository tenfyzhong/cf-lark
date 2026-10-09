import { defineConfig } from '@playwright/test';
import { browserAccessToken } from './test/support/browser-access';

export default defineConfig({
    testDir: './test/browser',
    use: { baseURL: 'http://localhost:8787', headless: true, channel: process.env.PLAYWRIGHT_CHANNEL,
        extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': browserAccessToken() } },
    webServer: [{
        command: `pnpm exec vite build && pnpm exec wrangler dev --local --config wrangler.jsonc --config wrangler.engine-docs.jsonc --config wrangler.engine-mail.jsonc --port 8787 --local-upstream localhost:8787 --upstream-protocol http --persist-to .wrangler/browser-${process.pid} --var PUBLIC_URL:http://localhost:8787 --var ACCESS_TEAM_DOMAIN:http://localhost:8789 --var ACCESS_AUD:fixture-application-audience --var ACCESS_EMAIL_DOMAIN:tenfy.cn --var ENCRYPTION_KEY:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`,
        url: 'http://localhost:8787', timeout: 60_000,
    }, {
        command: 'pnpm exec wrangler dev --local --config test/support/wrangler.access-jwks.jsonc --port 8789',
        url: 'http://localhost:8789/cdn-cgi/access/certs', timeout: 60_000,
    }, {
        command: 'pnpm exec wrangler dev --local --config test/support/wrangler.catalog.jsonc --port 8788',
        url: 'http://localhost:8788/health', timeout: 60_000,
    }],
});

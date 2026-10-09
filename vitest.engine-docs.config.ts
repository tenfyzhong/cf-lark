import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: { configPath: './wrangler.engine-docs.jsonc' },
        }),
    ],
    test: { include: ['test/engine-runtime/docs*.test.ts'] },
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './test/browser-live',
    outputDir: 'test-results/live',
    use: { baseURL: process.env.LARK_LIVE_URL, headless: true, trace: 'off', screenshot: 'off', video: 'off' },
});

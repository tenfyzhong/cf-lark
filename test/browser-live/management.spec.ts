import { test, expect } from '@playwright/test';

test.skip(!process.env.LARK_LIVE_URL, 'A live origin must be explicitly configured.');

for (const width of [1280, 390]) {
    test(`management sign-in uses the blue theme at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.goto('/');
        await expect(page.getByRole('link', { name: 'Sign in with Cloudflare Access' })).toHaveCSS('background-color', 'rgb(51, 112, 255)');
        await expect(page.getByLabel('Management secret')).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Management sign in' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
}

test('management sign-in opens the Cloudflare Access authentication page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.getByRole('link', { name: 'Sign in with Cloudflare Access' }).click();
    await expect(page).toHaveURL(/https:\/\/[a-z0-9-]+\.cloudflareaccess\.com\//u);
    await expect(page.getByRole('textbox', { name: /email/iu })).toBeVisible();
    expect(errors).toEqual([]);
});

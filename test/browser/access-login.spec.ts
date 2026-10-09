import { test, expect } from '@playwright/test';

for (const path of ['/', '/consent?handle=fixture']) {
    test(`management uses Access sign-in without a secret form at ${path}`, async ({ page }) => {
        await page.route('**/api/admin/session', (route) => route.fulfill({ status: 401, json: { message: 'Access login required.' } }));
        await page.goto(path);
        await expect(page.getByLabel('Management secret')).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Sign in with Cloudflare Access' })).toHaveAttribute('href',
            '/api/admin/access-login?returnTo=' + encodeURIComponent(path));
        await expect(page.getByText("Sign in with your organization's email.")).toBeVisible();
    });
}

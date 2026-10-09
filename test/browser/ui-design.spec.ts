import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.route('**/api/admin/session', (route) => route.fulfill({ json: { csrf: 'ui-fixture' } }));
    await page.route('**/api/admin/profiles', (route) => route.fulfill({ json: { profiles: [
        { id: 'ui-profile', name: 'Workspace application', brand: 'feishu', appId: 'cli_very_long_application_identifier_for_responsive_layout' },
    ] } }));
    await page.route('**/api/admin/profiles/ui-profile/accounts', (route) => route.fulfill({ json: { accounts: [] } }));
    await page.route('**/api/admin/usage', (route) => route.fulfill({ json: { bytes: 128, classA: 12, classB: 24 } }));
    await page.route('**/api/admin/grants', (route) => route.fulfill({ json: { items: [] } }));
});

test('management uses blue actions and line-style accessible tabs', async ({ page }, testInfo) => {
    await page.goto('/');
    const tabs = page.getByRole('tablist', { name: 'Management sections' });
    const applications = tabs.getByRole('tab', { name: 'Applications' });
    await expect(applications).toHaveAttribute('aria-selected', 'true');
    await expect(applications).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(applications).toHaveCSS('border-radius', '0px');
    await expect(applications).toHaveCSS('border-bottom-color', 'rgb(51, 112, 255)');
    await expect(page.getByRole('button', { name: 'Add application' })).toHaveCSS('background-color', 'rgb(51, 112, 255)');
    await expect(page.getByRole('tabpanel', { name: 'Applications' })).toBeVisible();
    await applications.focus();
    await page.keyboard.press('ArrowRight');
    const storage = tabs.getByRole('tab', { name: 'Storage' });
    await expect(storage).toBeFocused();
    await expect(storage).toHaveAttribute('aria-selected', 'true');
    await expect(applications).toHaveAttribute('tabindex', '-1');
    await expect(page.getByRole('tabpanel', { name: 'Storage' })).toContainText('2,000,000,000 bytes');
    await page.keyboard.press('End');
    await expect(tabs.getByRole('tab', { name: 'Clients' })).toBeFocused();
    await expect(page.getByRole('tabpanel', { name: 'Clients' })).toContainText('No authorized clients.');
    await page.keyboard.press('ArrowRight');
    await expect(applications).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.getByRole('tab', { name: 'Clients' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(applications).toBeFocused();
    await expect(page.getByRole('button', { name: 'Add application' })).toBeEnabled();
    await page.getByRole('heading', { name: 'Applications', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('management-desktop.png'), fullPage: true });
});

for (const width of [320, 390]) {
    test(`management remains readable without overflow at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        await page.goto('/');
        await expect(page.getByRole('heading', { name: 'Workspace application' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Applications' })).toBeVisible();
        await expect(page.getByLabel('Profile name')).toBeVisible();
        for (const name of ['Applications', 'Storage', 'Clients']) {
            await page.getByRole('tab', { name, exact: true }).click();
            await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        }
        await page.getByRole('tab', { name: 'Applications' }).click();
        await expect(page.getByLabel('App ID')).toHaveCSS('min-height', '40px');
        await page.screenshot({ path: testInfo.outputPath(`management-${width}.png`), fullPage: true });
    });
}

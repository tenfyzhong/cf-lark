import { test, expect } from '@playwright/test';

export function registerScopeDisclosureTests() {
    for (const width of [1280, 390]) {
        test(`scope lists start collapsed and toggle independently at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 844 });
            const scopes = Array.from({ length: 45 }, (_, index) => `fixture:account:scope_${index}_${'long_identifier_'.repeat(6)}`);
            let revoked = false;
            await page.route('**/api/admin/session', (route) => route.fulfill({ json: { csrf: 'scope-fixture' } }));
            await page.route('**/api/admin/profiles', (route) => route.fulfill({ json: { profiles: [
                { id: 'scope-profile', name: 'Scope application', brand: 'feishu', appId: 'cli_scope_fixture' },
            ] } }));
            await page.route('**/api/admin/profiles/scope-profile/accounts', (route) => route.fulfill({ json: { accounts: [
                { id: 'first', name: 'First account', scopes },
                { id: 'empty', name: 'Empty account', scopes: [] },
            ] } }));
            await page.route('**/api/admin/usage', (route) => route.fulfill({ json: { bytes: 0, classA: 0, classB: 0 } }));
            await page.route('**/api/admin/grants', (route) => route.fulfill({ json: { items: [
                { id: 'scope-grant', clientId: 'scope-client', scope: ['mcp:read', 'mcp:write'], metadata: { name: 'Scope client' } },
            ] } }));
            await page.route('**/api/admin/grants/scope-grant', (route) => {
                expect(route.request().method()).toBe('DELETE');
                revoked = true;
                return route.fulfill({ json: { ok: true } });
            });
            await page.goto('/');
            const firstScope = page.getByText(scopes[0]!, { exact: true });
            await expect(page.getByRole('button', { name: 'Sign out First account', exact: true })).toBeVisible();
            await expect(firstScope).not.toBeVisible();
            const disclosure = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Scopes (45)' }) });
            const summary = disclosure.locator('summary');
            await expect(summary).toHaveText('Scopes (45)');
            await summary.click();
            await expect(disclosure).toHaveAttribute('open', '');
            await expect(firstScope).toBeVisible();
            await expect(disclosure.getByRole('listitem')).toHaveCount(scopes.length);
            await expect(disclosure.getByRole('list')).toContainText(scopes[44]!);
            const dimensions = await disclosure.getByRole('list').evaluate((element) => ({
                height: element.clientHeight, content: element.scrollHeight,
            }));
            expect(dimensions.height).toBeLessThanOrEqual(256);
            expect(dimensions.content).toBeGreaterThan(dimensions.height);
            const empty = page.locator('summary', { hasText: 'Scopes (0)' });
            await empty.click();
            await expect(page.getByText('No scopes.', { exact: true })).toBeVisible();
            await expect(firstScope).toBeVisible();
            await summary.focus();
            await page.keyboard.press('Enter');
            await expect(firstScope).not.toBeVisible();
            await expect(page.getByText('No scopes.', { exact: true })).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.getByRole('tab', { name: 'Clients', exact: true }).click();
            const clientScope = page.getByText('mcp:read', { exact: true });
            await expect(clientScope).not.toBeVisible();
            const clientSummary = page.locator('summary', { hasText: 'Scopes (2)' });
            await clientSummary.click();
            await expect(clientScope).toBeVisible();
            await expect(page.getByText('mcp:write', { exact: true })).toBeVisible();
            await clientSummary.click();
            await expect(clientScope).not.toBeVisible();
            expect(revoked).toBe(false);
            await page.getByRole('button', { name: 'Revoke access', exact: true }).click();
            await expect(page.getByRole('heading', { name: 'Scope client' })).not.toBeVisible();
            expect(revoked).toBe(true);
        });
    }
}

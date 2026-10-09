import { test, expect } from '@playwright/test';

test('management login, profile creation, usage and logout', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Lark MCP' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
    const name = `Browser app ${Date.now()}`;
    await page.getByLabel('Profile name').fill(name);
    await page.getByLabel('App ID').fill('cli_browser');
    await page.getByLabel('App Secret', { exact: true }).fill('browser-fixture-secret');
    await page.getByRole('button', { name: 'Add application' }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByLabel('App Secret', { exact: true })).toHaveValue('');
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name }) });
    await page.route('**/api/admin/profiles/*/login', async (route) => route.fulfill({ json: { id: 'flow-fixture', status: 'pending', verificationUri: 'https://accounts.larksuite.com/authorize', nextPollAt: Date.now() - 1 } }));
    await page.route('**/api/admin/flows/flow-fixture/poll', async (route) => route.fulfill({ json: { id: 'flow-fixture', status: 'authorized', accountId: 'owner' } }));
    await expect(card.getByLabel('Requested Lark scopes')).toHaveCount(0);
    await card.getByRole('button', { name: 'Authorize account' }).click();
    await expect(card.getByRole('link', { name: 'Open Lark authorization' })).toHaveAttribute('href', 'https://accounts.larksuite.com/authorize');
    await card.getByRole('button', { name: 'Check authorization' }).click();
    await expect(card.getByText('Authorization complete.')).toBeVisible();
    await page.getByRole('tab', { name: 'Storage' }).click();
    await expect(page.getByText('2,000,000,000 bytes')).toBeVisible();
    await page.route('**/api/admin/grants', (route) => route.fulfill({ json: { items: [{ id: 'grant-fixture', clientId: 'client-fixture', scope: ['mcp:read'], metadata: { name: 'Fixture client' } }] } }));
    await page.route('**/api/admin/grants/grant-fixture', (route) => route.fulfill({ json: { ok: true } }));
    await page.getByRole('tab', { name: 'Clients', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Fixture client' })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke access', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Fixture client' })).not.toBeVisible();
    await page.route('**/api/admin/logout', (route) => route.fulfill({ json: { redirectTo: '/signed-out-fixture' } }));
    await page.route('**/signed-out-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Access session ended</h1>' }));
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Access session ended' })).toBeVisible();
});

test('consent shows the destination and sends only explicitly selected access', async ({ page }) => {
    await page.route('**/api/admin/consent/fixture', async (route) => {
        if (route.request().method() === 'POST') {
            expect(route.request().postDataJSON()).toEqual({ profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }], domains: ['calendar'], permissions: ['read'] });
            return route.fulfill({ json: { redirectTo: '/' } });
        }
        return route.fulfill({ json: { client: { clientName: 'Test MCP client', redirectHost: 'localhost', redirectIsLoopback: true, scope: ['mcp:read'] }, profiles: [{ id: 'p', name: 'Consent app', accounts: [] }], domains: ['calendar', 'im'] } });
    });
    await page.goto('/consent?handle=fixture');
    await expect(page.getByText('Test MCP client', { exact: true })).toBeVisible();
    await expect(page.getByText('localhost', { exact: true })).toBeVisible();
    await page.getByLabel('Consent app: bot identity').check();
    await page.getByLabel('calendar', { exact: true }).check();
    await page.getByRole('button', { name: 'Authorize client', exact: true }).click();
    await expect(page).toHaveURL('http://localhost:8787/');
});

for (const allowWrite of [false, true]) {
    test(`consent selects and clears all available access (write requested: ${allowWrite})`, async ({ page }) => {
        let submissions = 0;
        await page.route('**/api/admin/consent/bulk', async (route) => {
            if (route.request().method() === 'POST') {
                submissions++;
                expect(route.request().postDataJSON()).toEqual({
                    profiles: [
                        { profileId: 'p', identities: ['bot', 'user'], accounts: ['a', 'b'] },
                        { profileId: 'empty', identities: ['bot'], accounts: [] },
                    ],
                    domains: ['calendar'], permissions: allowWrite ? ['read', 'write'] : ['read'],
                });
                return route.fulfill({ json: { redirectTo: '/' } });
            }
            return route.fulfill({ json: {
                client: { clientName: 'Bulk client', redirectHost: 'localhost', redirectIsLoopback: true, scope: allowWrite ? ['mcp:read', 'mcp:write'] : ['mcp:read'] },
                profiles: [
                    { id: 'p', name: 'Main app', accounts: [{ id: 'a', name: 'First account' }, { id: 'b', name: 'Second account' }] },
                    { id: 'empty', name: 'Bot app', accounts: [] },
                ], domains: ['calendar', 'im'],
            } });
        });
        await page.goto('/consent?handle=bulk');
        await expect(page.getByText('Bulk client', { exact: true })).toBeVisible();
        await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
        await page.getByRole('button', { name: 'Select all', exact: true }).click();
        await expect(page.getByLabel('First account', { exact: true })).toBeChecked();
        await expect(page.getByLabel('Second account', { exact: true })).toBeChecked();
        await expect(page.getByLabel('Bot app: user identity')).not.toBeChecked();
        if (allowWrite) await expect(page.getByLabel('Allow write operations')).toBeChecked();
        else await expect(page.getByLabel('Allow write operations')).toHaveCount(0);
        expect(submissions).toBe(0);
        await page.getByRole('button', { name: 'Clear all', exact: true }).click();
        await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
        expect(submissions).toBe(0);
        await page.getByRole('button', { name: 'Select all', exact: true }).click();
        await page.getByLabel('im', { exact: true }).uncheck();
        await page.getByRole('button', { name: 'Authorize client', exact: true }).click();
        await expect(page).toHaveURL('http://localhost:8787/');
        expect(submissions).toBe(1);
    });
}

test('consent disables and grays actions during submission, recovers on failure and waits for navigation', async ({ page }) => {
    let releaseRequest!: () => void;
    let releaseNavigation!: () => void;
    const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
    const navigationGate = new Promise<void>((resolve) => { releaseNavigation = resolve; });
    let submissions = 0;
    await page.route('**/api/admin/consent/pending', async (route) => {
        if (route.request().method() === 'POST') {
            submissions++;
            if (submissions === 1) {
                await requestGate;
                return route.fulfill({ status: 503, json: { message: 'Please retry authorization.' } });
            }
            return route.fulfill({ json: { redirectTo: '/consent-complete' } });
        }
        return route.fulfill({ json: {
            client: { clientName: 'Pending client', redirectHost: 'localhost', redirectIsLoopback: true, scope: ['mcp:read'] },
            profiles: [{ id: 'p', name: 'Pending app', accounts: [] }], domains: ['calendar'],
        } });
    });
    await page.route('**/consent-complete', async (route) => {
        await navigationGate;
        await route.fulfill({ contentType: 'text/html', body: '<h1>Consent complete</h1>' });
    });
    try {
        await page.goto('/consent?handle=pending');
        await page.getByRole('button', { name: 'Select all', exact: true }).click();
        const authorize = page.getByRole('button', { name: /Authorize client|Authorizing/ });
        await authorize.click();
        await expect(authorize).toBeDisabled();
        await expect(authorize).toHaveText('Authorizing...');
        await expect(authorize).toHaveCSS('background-color', 'rgb(239, 240, 241)');
        await expect(page.getByRole('button', { name: 'Deny', exact: true })).toBeDisabled();
        expect(submissions).toBe(1);
        releaseRequest();
        await expect(page.getByRole('alert')).toHaveText('Please retry authorization.');
        await expect(authorize).toBeEnabled();
        await expect(authorize).toHaveText('Authorize client');
        let disabledAtNavigation: boolean | undefined;
        await page.exposeFunction('recordConsentNavigation', (disabled: boolean) => { disabledAtNavigation = disabled; });
        await page.evaluate(() => {
            window.addEventListener('beforeunload', () => {
                const disabled = document.querySelector<HTMLButtonElement>('button[aria-busy="true"]')?.disabled === true;
                void (window as unknown as { recordConsentNavigation: (value: boolean) => Promise<void> }).recordConsentNavigation(disabled);
            }, { once: true });
        });
        const navigating = page.waitForRequest('**/consent-complete');
        await authorize.click({ noWaitAfter: true });
        await navigating;
        await expect.poll(() => disabledAtNavigation).toBe(true);
        expect(submissions).toBe(2);
        releaseNavigation();
        await expect(page.getByRole('heading', { name: 'Consent complete' })).toBeVisible();
    } finally { releaseRequest(); releaseNavigation(); }
});

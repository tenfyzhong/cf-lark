import { test, expect } from '@playwright/test';

const cases = [
    { command: 'application.+slash-command-list', args: {}, identity: 'user', expected: { count: 1 } },
    { command: 'application.+slash-command-create', args: { command: 'fixture', description: 'Fixture' }, identity: 'bot', expected: { action: 'created' } },
    { command: 'application.+slash-command-update', args: { command: 'fixture', description: 'Updated' }, identity: 'user', expected: { action: 'updated' } },
    { command: 'application.+slash-command-delete', args: { 'command-id': 'fixture-id' }, identity: 'bot', expected: { action: 'deleted' } },
    { command: 'contact.+get-user', args: {}, identity: 'user', expected: { user: { open_id: 'ou_fixture' } } },
    { command: 'contact.+get-user', args: { 'user-id': 'ou_fixture' }, identity: 'bot', expected: { user: { open_id: 'ou_fixture' } } },
    { command: 'contact.+search-user', args: { query: 'Fixture' }, identity: 'user', expected: { users: [{ open_id: 'ou_fixture' }], has_more: false } },
    { command: 'contact.+search-bot', args: { queries: 'Fixture,Other' }, identity: 'user', expected: { bots: [{ name: 'Fixture & Bot' }, { name: 'Fixture & Bot' }] } },
];
for (const item of cases) {
    test(`native domain shortcut: ${item.command} as ${item.identity}`, async ({ request }) => {
        let id = 0;
        const call = async (dryRun: boolean) => {
            const response = await request.post('http://localhost:8788/mcp', {
                headers: { Accept: 'application/json, text/event-stream', 'X-Fixture-Scenario': 'domains' },
                data: { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'lark_execute', arguments: { command: item.command, args: item.args, identity: item.identity, dryRun } } },
            });
            const body = await response.json();
            expect(response.status()).toBe(200);
            expect(body.error).toBeUndefined();
            expect(body.result.isError, JSON.stringify(body.result)).not.toBe(true);
            return { data: body.result.structuredContent.data, requests: response.headers()['x-fixture-requests'], tokens: response.headers()['x-fixture-tokens'] };
        };
        expect(await call(true)).toMatchObject({ requests: '0', tokens: '0' });
        expect((await call(false)).data).toMatchObject(item.expected);
    });
}

import { test, expect } from '@playwright/test';

for (const identity of ['user', 'bot']) {
    for (const command of ['docs.+create', 'im.+messages-send']) {
        test(`native Worker shortcut: ${command} as ${identity}`, async ({ request }) => {
            let id = 0;
            const call = async (name: string, args: Record<string, unknown>) => {
                const response = await request.post('http://localhost:8788/mcp', {
                    headers: { Accept: 'application/json, text/event-stream', 'X-Fixture-Scenario': 'shortcuts' },
                    data: { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } },
                });
                const body = await response.json();
                expect(response.status()).toBe(200);
                expect(body.error).toBeUndefined();
                expect(body.result.isError, JSON.stringify(body.result)).not.toBe(true);
                return { data: body.result.structuredContent, headers: response.headers() };
            };
            const query = command.startsWith('docs') ? 'create document' : 'send message';
            expect((await call('lark_search', { query })).data.commands.map((item: { id: string }) => item.id)).toContain(command);
            expect((await call('lark_schema', { command })).data.risk).toBe('write');
            const args = command.startsWith('docs') ? { title: 'Fixture', content: '**Body**', 'doc-format': 'markdown' }
                : { 'user-id': 'ou_fixture', text: 'Fixture message', 'idempotency-key': 'fixture' };
            const preview = await call('lark_execute', { command, identity, args, dryRun: true });
            expect(preview.headers['x-fixture-requests']).toBe('0');
            expect(preview.headers['x-fixture-tokens']).toBe('0');
            let executed = await call('lark_execute', { command, identity, args });
            const requests: Array<{ method: string; path: string; body: unknown }> = [];
            const collect = () => requests.push(...JSON.parse(executed.headers['x-fixture-calls'] ?? '[]'));
            collect();
            const workflowId = executed.data.data.workflowId;
            for (let step = 0; executed.data.data.status === 'pending' && step < 20; step++) {
                executed = await call('lark_execute', { command: 'workflow.resume', identity, args: { id: workflowId } });
                collect();
            }
            expect(executed.data.data.status).not.toBe('pending');
            if (command.startsWith('docs')) {
                expect(executed.data.data.status).toBe('completed');
                expect(executed.data.data.output.document.document_id).toBe('fixture-doc');
                const writes = requests.filter(item => item.path === '/open-apis/docs_ai/v1/documents');
                expect(writes).toHaveLength(1);
                expect(writes[0]).toMatchObject({ method: 'POST', body: { content: '<title>Fixture</title>\n**Body**', format: 'markdown' } });
                const replay = await call('lark_execute', { command: 'workflow.resume', identity, args: { id: workflowId } });
                expect(replay.data.data).toEqual(executed.data.data);
                expect(replay.headers['x-fixture-requests']).toBe('0');
            } else {
                expect(requests).toHaveLength(1);
                expect(requests[0]).toMatchObject({ method: 'POST', path: '/open-apis/im/v1/messages', body: preview.data.data.body });
                expect(executed.data.data).toEqual({ message_id: 'om_fixture', chat_id: 'oc_fixture', create_time: '2023-11-14 22:13:20' });
            }
        });
    }
}

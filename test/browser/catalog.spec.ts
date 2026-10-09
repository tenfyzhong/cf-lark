import { test, expect } from '@playwright/test';
import catalog from '../../src/capabilities/api/generated/catalog.json' with { type: 'json' };
import { eventCapability } from '../../src/capabilities/event/inbox';
import { exampleArguments } from '../support/schema-examples';

const definitions = [...catalog.map((item) => item.definition),
    eventCapability({ read: async () => ({ events: [], cursor: 0 }) }).definition];

for (const definition of definitions) {
    test(`native Worker command contract: ${definition.id}`, async ({ request }) => {
        let id = 0;
        const call = async (name: string, args: Record<string, unknown>) => {
            const response = await request.post('http://localhost:8788/mcp', { headers: { Accept: 'application/json, text/event-stream' },
                data: { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } } });
            const body = await response.json();
            expect(response.status(), JSON.stringify(body)).toBe(200);
            expect(body.error, JSON.stringify(body)).toBeUndefined();
            return { result: body.result, headers: response.headers() };
        };
        const schema = await call('lark_schema', { command: definition.id });
        expect(schema.result.structuredContent.id).toBe(definition.id);
        const args = exampleArguments(definition.inputSchema);
        for (const identity of definition.identities) {
            const input = { command: definition.id, args, identity };
            const preview = await call('lark_execute', { ...input, dryRun: true });
            expect(preview.result.isError, JSON.stringify(preview.result)).not.toBe(true);
            expect(preview.headers['x-fixture-requests']).toBe('0');
            expect(preview.headers['x-fixture-tokens']).toBe('0');
            const executed = await call('lark_execute', input);
            expect(executed.result.isError, JSON.stringify(executed.result)).not.toBe(true);
            expect(executed.result.structuredContent.ok).toBe(true);
            expect(executed.result.structuredContent.identity).toBe(identity);
            if (definition.source === 'api') {
                const planned = preview.result.structuredContent.data;
                const actual = executed.result.structuredContent.data;
                expect(actual.method).toBe(planned.method);
                const url = new URL(actual.url);
                expect(url.origin).toBe('https://open.feishu.cn');
                expect(url.pathname).toBe(planned.path);
                expect(url.pathname).not.toMatch(/[{}]/u);
                for (const [key, value] of Object.entries(planned.query)) expect(url.searchParams.get(key)).toBe(typeof value === 'object' ? JSON.stringify(value) : String(value));
                expect(actual.body).toEqual(planned.body ?? null);
                expect(executed.headers['x-fixture-requests']).toBe('1');
                expect(executed.headers['x-fixture-tokens']).toBe('1');
            } else {
                expect(executed.headers['x-fixture-requests']).toBe('0');
            }
        }
        const invalid = await call('lark_execute', { command: definition.id, args: { unexpected: true },
            identity: definition.identities[0], dryRun: true });
        expect(invalid.result.isError).toBe(true);
        expect(JSON.parse(invalid.result.content[0].text).code).toBe('INVALID_ARGUMENTS');
        expect(invalid.headers['x-fixture-requests']).toBe('0');
    });
}

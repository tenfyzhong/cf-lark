import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpResponse } from '../src/adapters/mcp/handler';
import { Dispatcher } from '../src/application/dispatcher';
import { Registry } from '../src/capabilities/registry';
import { fixtureValidator } from './support/schema-validator';
import type { Grant } from '../src/domain/models';

it('supports SDK initialization, exactly three tools, schema, execution and revocation', async () => {
    const grant: Grant = { id: 'g', expiresAt: Date.now() + 60_000, revoked: false, profiles: [{ profileId: 'p', accounts: [], identities: ['bot'] }], domains: ['calendar'], permissions: ['read'] };
    const execute = vi.fn(async () => ({ items: [1] }));
    const dispatcher = new Dispatcher(new Registry([{
        definition: { id: 'calendar.list', domain: 'calendar', description: 'List calendars', inputSchema: { type: 'object', additionalProperties: false }, identities: ['bot'], scopes: [], risk: 'read', source: 'api' },
        execute, preview: async () => ({ planned: true }),
    }]), fixtureValidator(), async () => ({ request: vi.fn() }));
    const transport = new StreamableHTTPClientTransport(new URL('https://example.com/mcp'), {
        fetch: async (input, init) => mcpResponse(new Request(input, init), dispatcher, grant),
    });
    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    await client.connect(transport);
    expect(client.getServerVersion()?.name).toBe('cf-lark');
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['lark_search', 'lark_schema', 'lark_execute']);
    const search = await client.callTool({ name: 'lark_search', arguments: { query: 'calendar' } });
    expect(search.structuredContent).toMatchObject({ executionContext: { profiles: [{ profileId: 'p', accountIds: [], identities: ['bot'] }] } });
    const result = await client.callTool({ name: 'lark_execute', arguments: { command: 'calendar.list', args: {}, identity: 'bot' } });
    expect(result.isError).not.toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    const schema = await client.callTool({ name: 'lark_schema', arguments: { command: 'calendar.list' } });
    expect(schema.structuredContent).toMatchObject({ id: 'calendar.list' });
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    grant.revoked = true;
    expect((await client.callTool({ name: 'lark_execute', arguments: { command: 'calendar.list', args: {}, identity: 'bot' } })).isError).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(warnings).toHaveBeenCalledWith(JSON.stringify({ event: 'mcp_tool_error', tool: 'lark_execute', code: 'GRANT_EXPIRED' }));
    warnings.mockRestore();
    await client.close();
});

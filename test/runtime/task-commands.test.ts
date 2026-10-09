import { expect, it, vi } from 'vitest';
import { mcpResponse } from '../../src/adapters/mcp/handler';
import { Dispatcher } from '../../src/application/dispatcher';
import { Registry } from '../../src/capabilities/registry';
import { apiCapability } from '../../src/capabilities/api/command';
import catalog from '../../src/capabilities/api/generated/catalog.json';
import type { ApiDescriptor } from '../../src/domain/api-descriptor';
import type { Grant } from '../../src/domain/models';
import { SchemaValidator } from '../../src/infrastructure/validation/schema-validator';

it.each(['task.tasks.list', 'task.tasklists.list'])('executes %s using the catalog and precompiled validation', async (command) => {
    const descriptor = (catalog as unknown as ApiDescriptor[]).find((item) => item.definition.id === command)!;
    const request = vi.fn(async () => ({ items: [], has_more: false }));
    const dispatcher = new Dispatcher(new Registry([apiCapability(descriptor)]), new SchemaValidator(), async () => ({ request }));
    const grant: Grant = { id: 'g', expiresAt: Date.now() + 60_000, revoked: false,
        profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], domains: ['task'], permissions: ['read'] };
    const response = await mcpResponse(new Request('https://service.example/mcp', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lark_execute',
            arguments: { command, args: { params: { page_size: 20 } }, identity: 'user' } } }),
    }), dispatcher, grant);
    const body = await response.json() as { result: { isError?: boolean; structuredContent: unknown } };
    expect(body.result.isError).not.toBe(true);
    expect(body.result.structuredContent).toMatchObject({ ok: true, selection: { profileId: 'p', accountId: 'a', identity: 'user' }, data: { items: [] } });
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: descriptor.path, query: { page_size: 20 } });
});

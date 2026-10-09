import { expect, it, vi } from 'vitest';
import { mcpResponse } from '../../src/adapters/mcp/handler';
import { Dispatcher } from '../../src/application/dispatcher';
import { createCapabilities } from '../../src/capabilities/catalog';
import { Registry } from '../../src/capabilities/registry';
import { SchemaValidator } from '../../src/infrastructure/validation/schema-validator';
import type { Grant, JsonObject } from '../../src/domain/models';

it('accepts generated typed flags through native MCP and central dependency composition', async () => {
    const unavailable = async (): Promise<never> => { throw new Error('This request must not invoke an unrelated port.'); };
    const request = vi.fn(async () => ({ calendar: { calendar_id: 'primary' } }));
    const registry = new Registry(createCapabilities({ artifacts: { stat: unavailable, read: unavailable, upload: unavailable, remove: unavailable }, events: { read: unavailable }, workflows: { start: unavailable, resume: unavailable } }));
    const dispatcher = new Dispatcher(registry, new SchemaValidator(), async () => ({ request }));
    const grant: Grant = { id: 'native-typed-api', expiresAt: Date.now() + 60000, revoked: false, domains: ['calendar'], permissions: ['read'], profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }] };
    const response = await mcpResponse(new Request('https://service.example/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lark_execute', arguments: { identity: 'user', command: 'calendar.calendars.get', args: { 'calendar-id': 'primary', params: '{"future":false}' } } } }) }), dispatcher, grant);
    const result = await response.json() as { result: { isError?: boolean; content: unknown; structuredContent: JsonObject } };
    expect(result.result.isError, JSON.stringify(result.result.content)).not.toBe(true);
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/open-apis/calendar/v4/calendars/primary', query: { future: false } });
});

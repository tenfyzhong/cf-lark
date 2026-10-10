import { expect, it, vi } from 'vitest';
import { mcpResponse } from '../../src/adapters/mcp/handler';
import { Dispatcher } from '../../src/application/dispatcher';
import { Registry } from '../../src/capabilities/registry';
import { applicationCapabilities } from '../../src/capabilities/application/commands';
import { SchemaValidator } from '../../src/infrastructure/validation/schema-validator';
import { LarkHttpClient } from '../../src/infrastructure/lark/http-client';
import type { Grant, JsonObject } from '../../src/domain/models';

const grant: Grant = { id: 'native-auth-diagnostic', expiresAt: Date.now() + 60000, revoked: false,
    profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], domains: ['docs'], permissions: ['read'] };
const definition = { id: 'docs.write', domain: 'docs', description: 'Write fixture', inputSchema: { type: 'object' },
    identities: ['user'] as const, scopes: ['docs:write'], risk: 'write' as const, source: 'api' as const };
function call(dispatcher: Dispatcher, name: string, args: JsonObject, selectedGrant: Grant = grant) {
    return mcpResponse(new Request('https://service.example/mcp', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), dispatcher, selectedGrant);
}

it('returns grant-safe diagnostic metadata through native MCP without upstream access', async () => {
    const execute = vi.fn(), createClient = vi.fn(async () => ({ request: vi.fn() }));
    const inspectAuthorization = vi.fn(async () => ({ profileExists: true, credentialStatus: 'present' as const,
        expiresAt: Date.now() - 1000, refreshExpiresAt: Date.now() + 120000, scopes: ['private-scope-secret'],
        tokenType: 'DPoP' as const, bindingStatus: 'missing_key' as const, accessToken: 'access-secret', refreshToken: 'refresh-secret' }));
    const dispatcher = new Dispatcher(new Registry([{ definition, execute, preview: execute }]), new SchemaValidator(), createClient, Date.now, { inspectAuthorization });
    const response = await call(dispatcher, 'lark_auth_diagnose', { identity: 'user', command: 'docs.write' });
    const body = await response.json() as { result: { isError?: boolean; structuredContent: JsonObject } };
    expect(body.result.isError).not.toBe(true);
    expect(body.result.structuredContent).toMatchObject({ grant: { domain: 'allowed', permission: 'denied' },
        credentials: { token: 'expired', bindingStatus: 'missing_key' }, appScopes: { status: 'unknown' },
        userScopes: { status: 'missing_catalog_scopes', missing: ['docs:write'] } });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(createClient).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
    const denied = await (await call(dispatcher, 'lark_auth_diagnose', { identity: 'user', accountId: 'outside' })).json() as { result: { isError?: boolean; content: { text: string }[] } };
    expect(denied.result.isError).toBe(true);
    expect(denied.result.content[0]!.text).toContain('FORBIDDEN');
    expect(inspectAuthorization).toHaveBeenCalledOnce();
});

it('serializes safe HTTP rate-limit metadata through native MCP and does not replay a write', async () => {
    const send = vi.fn(async () => Response.json({ code: 99991400, msg: 'credential-secret', error: {
        log_id: '202610100228001234ABCDEF', troubleshooter: 'https://evil.example/secret' } }, { status: 429, headers: { 'Retry-After': '19' } }));
    const client = new LarkHttpClient('feishu', async () => 'credential-secret', send);
    const command = applicationCapabilities().find(item => item.definition.id === 'application.+slash-command-create')!;
    const dispatcher = new Dispatcher(new Registry([command]), new SchemaValidator(), async () => client);
    const response = await call(dispatcher, 'lark_execute', { identity: 'user', command: command.definition.id,
        args: { command: 'hello', description: 'Runtime fixture' } }, { ...grant, domains: ['application'], permissions: ['read', 'write'] });
    const body = await response.json() as { result: { isError?: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(JSON.parse(body.result.content[0]!.text)).toMatchObject({ code: 'UPSTREAM_HTTP_ERROR', details: {
        subtype: 'rate_limited', retryable: false, retry_after_seconds: 19, log_id: '202610100228001234ABCDEF' } });
    expect(JSON.stringify(body)).not.toMatch(/secret|evil\.example/u);
    expect(send).toHaveBeenCalledOnce();
});

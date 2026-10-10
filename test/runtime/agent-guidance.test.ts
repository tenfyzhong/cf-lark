import { expect, it, vi } from 'vitest';
import { mcpResponse } from '../../src/adapters/mcp/handler';
import { Dispatcher } from '../../src/application/dispatcher';
import { createCapabilities } from '../../src/capabilities/catalog';
import { Registry } from '../../src/capabilities/registry';
import { SchemaValidator } from '../../src/infrastructure/validation/schema-validator';
import type { Grant, JsonObject } from '../../src/domain/models';

const root = 'cf-lark://guidance/v1/';
function fixture() {
    const unexpected = vi.fn(async (): Promise<never> => { throw new Error('Discovery must not execute a dependency.'); });
    const registry = new Registry(createCapabilities({ artifacts: { upload: unexpected, read: unexpected, remove: unexpected, stat: unexpected }, workflows: { start: unexpected, resume: unexpected }, events: { read: unexpected } }));
    const dispatcher = new Dispatcher(registry, new SchemaValidator(), unexpected);
    const grant: Grant = { id: 'native-guidance', revoked: false, expiresAt: Date.now() + 60000, profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], domains: ['docs', 'workflow', 'artifact', 'event', 'mail'], permissions: ['read', 'write'] };
    const call = async (method: string, params: JsonObject = {}, authorization = grant) => {
        const response = await mcpResponse(new Request('https://service.example/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), dispatcher, authorization);
        return await response.json() as { result?: JsonObject; error?: JsonObject };
    };
    return { call, grant, unexpected };
}

it('discovers actual catalog commands and versioned skill references through native MCP', async () => {
    const { call, unexpected } = fixture();
    const result = await call('tools/call', { name: 'lark_search', arguments: { query: '\u521b\u5efa\u6587\u6863' } });
    const search = result.result?.structuredContent as JsonObject;
    expect(search.guidance).toMatchObject({ version: 1, indexUri: `${root}index` });
    expect(search.commands).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'docs.+create' })]));
    const listed = await call('resources/list');
    expect(listed.result?.resources).toEqual(expect.arrayContaining([expect.objectContaining({ uri: `${root}references/workflows` }), expect.objectContaining({ uri: `${root}skills/docs` })]));
    for (const path of ['index', 'skills/docs', 'references/workflows', 'references/artifacts', 'references/watches', 'references/limits']) {
        const result = await call('resources/read', { uri: root + path });
        expect(result.error).toBeUndefined();
        const content = (result.result?.contents as { text: string; mimeType: string }[])[0]!;
        expect(content.mimeType).toBe('application/json');
        expect(JSON.parse(content.text)).toMatchObject({ version: 1, authority: 'reference-only' });
    }
    expect(unexpected).not.toHaveBeenCalled();
});

it('keeps native resource discovery and multilingual search inside the active grant', async () => {
    const { call, grant, unexpected } = fixture();
    const restricted: Grant = { ...grant, domains: ['docs'], permissions: ['read'] };
    const result = await call('tools/call', { name: 'lark_search', arguments: { query: '\u521b\u5efa\u6587\u6863' } }, restricted);
    expect((result.result?.structuredContent as JsonObject).commands).toEqual([]);
    const listed = await call('resources/list', {}, restricted);
    expect(JSON.stringify(listed)).not.toContain('skills/mail');
    expect((await call('resources/read', { uri: `${root}skills/mail` }, restricted)).error).toBeDefined();
    expect((await call('resources/read', { uri: `${root}index` }, { ...restricted, revoked: true })).error).toBeDefined();
    expect(unexpected).not.toHaveBeenCalled();
});

import { describe, expect, it, vi } from 'vitest';
import { compileService } from '../scripts/catalog/compile';
import { apiCapability } from '../src/capabilities/api/command';

describe('upstream catalog compilation and execution', () => {
    const service = { name: 'calendar', servicePath: '/open-apis/calendar/v4', resources: {
        events: { methods: { list: {
            httpMethod: 'GET', path: 'calendars/{calendar_id}/events', description: 'List events', risk: 'read', accessTokens: ['user', 'tenant'], scopes: ['calendar:calendar:read'],
            parameters: { calendar_id: { type: 'string', location: 'path', required: true }, page_size: { type: 'integer', location: 'query' } },
        } } },
    } };

    it('generates structural schemas with canonical IDs', () => {
        const [entry] = compileService(service);
        expect(entry!.definition).toMatchObject({ id: 'calendar.events.list', domain: 'calendar', identities: ['user', 'bot'], risk: 'read' });
        expect(entry!.definition.inputSchema).toMatchObject({ required: [], properties: { params: { anyOf: [{ required: [] }, { type: 'string' }] }, 'calendar-id': { type: 'string' } } });
    });
    it('encodes path components and sends only declared query parameters', async () => {
        const command = apiCapability(compileService(service)[0]!);
        const request = vi.fn(async () => ({ items: [1], has_more: false }));
        await command.execute({ params: { calendar_id: 'a/b', page_size: 7 } }, { lark: { request } } as never);
        expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/open-apis/calendar/v4/calendars/a%2Fb/events', query: { page_size: 7 } });
    });
    it('offers a side-effect-free request preview', async () => {
        const command = apiCapability(compileService(service)[0]!);
        expect(await command.preview({ params: { calendar_id: 'primary' } })).toMatchObject({ method: 'GET', path: '/open-apis/calendar/v4/calendars/primary/events' });
    });
    it('does not silently accept unresolved path parameters', async () => {
        const command = apiCapability(compileService(service)[0]!);
        await expect(command.preview({ params: {} })).rejects.toThrow();
    });
    it('keeps generated repository descriptions English', () => {
        const source = structuredClone(service);
        source.resources.events.methods.list.description = String.fromCodePoint(0x4e2d, 0x6587);
        const result = compileService(source);
        expect(JSON.stringify(result)).not.toMatch(/\p{Script=Han}/u);
        expect(result[0]!.definition.description).toContain('calendar');
    });
});

it('compiles common execution flags, raw JSON inputs and typed parameter aliases', () => {
    const [entry] = compileService({ name: 'im', servicePath: '/open-apis/im/v1', resources: { images: { methods: { create: { httpMethod: 'POST', path: 'images', parameters: { user_id: { type: 'string', location: 'query', required: true } }, requestBody: { image_type: { type: 'string', required: true }, image: { type: 'file', required: true } } } } } } });
    const properties = entry!.definition.inputSchema.properties as Record<string, unknown>;
    for (const key of ['user-id', 'params', 'body', 'data', 'file', 'output', 'page-all', 'page-limit', 'page-delay', 'jq', 'format', 'json', 'dry-run', 'yes']) expect(properties).toHaveProperty(key);
    expect(entry).toMatchObject({ fileFields: ['image'], parameterFlags: { 'user-id': 'user_id' }, requiredParameters: ['user_id'] });
    expect(entry!.definition.inputSchema.required).toEqual([]);
});
it('preserves raw query escape hatches, typed precedence, zero and false', async () => {
    const [entry] = compileService({ name: 'calendar', servicePath: '/open-apis/calendar/v4', resources: { events: { methods: { list: { httpMethod: 'GET', path: '{calendar_id}', risk: 'read', parameters: { calendar_id: { type: 'string', location: 'path', required: true }, page_size: { type: 'integer', location: 'query', required: true }, deleted: { type: 'boolean', location: 'query' } } } } } }});
    const preview = await apiCapability(entry!).preview({ params: '{"calendar_id":"original","page_size":9,"deleted":false,"future":0}', 'calendar-id': 'override', 'page-size': 0 });
    expect(preview).toMatchObject({ path: '/open-apis/calendar/v4/override', query: { page_size: 0, deleted: false, future: 0 } });
    await expect(apiCapability(entry!).preview({ 'calendar-id': 'primary', 'page-all': true })).resolves.toBeDefined();
    await expect(apiCapability(entry!).preview({ 'calendar-id': 'primary' })).rejects.toThrow('page_size');
});
it('validates path identifiers and permits raw bodies on undeclared write methods', async () => {
    const [entry] = compileService({ name: 'drive', servicePath: '/open-apis/drive/v1', resources: { files: { methods: { patch: { httpMethod: 'PATCH', path: '{file_token}', parameters: { file_token: { type: 'string', location: 'path', required: true } } } } } } });
    const capability = apiCapability(entry!);
    await expect(capability.preview({ 'file-token': '../unsafe' })).rejects.toThrow();
    await expect(capability.preview({ 'file-token': 'a%2fb' })).rejects.toThrow();
    expect(await capability.preview({ 'file-token': 'safe', data: '[1,2,3]' })).toMatchObject({ method: 'PATCH', path: '/open-apis/drive/v1/safe', body: [1, 2, 3] });
});
it('keeps explicit null bodies and parses metadata-derived multipart fields', async () => {
    const [entry] = compileService({ name: 'im', servicePath: '/open-apis/im/v1', resources: { images: { methods: { create: { httpMethod: 'POST', path: 'images', requestBody: { image: { type: 'file' } } } } } } });
    const command = apiCapability(entry!);
    expect(await command.preview({ body: null })).toMatchObject({ body: null });
    expect(await command.preview({ file: 'artifact:upload/picture.png', data: { image_type: 'message' } })).toMatchObject({ file: { id: 'upload', name: 'picture.png', field: 'image' }, body: { image_type: 'message' } });
    for (const options of [{ output: 'file' }, { 'page-all': true }, { data: '[]' }]) await expect(command.preview({ file: 'artifact:upload/picture.png', ...options })).rejects.toThrow();
});
it('defers artifact previews and starts typed workflows under the original domain and risk', async () => {
    const { apiPrograms } = await import('../src/capabilities/api/command');
    const descriptors = compileService({ name: 'calendar', servicePath: '/open-apis/calendar/v4', resources: { events: { methods: { search: { httpMethod: 'POST', path: 'events/search', risk: 'read' } } } } });
    const start = vi.fn(async (_id: string, _state: Record<string, unknown>, _selection: unknown, _grant: unknown) => ({ workflowId: 'w' }));
    const command = apiCapability(descriptors[0]!, { workflows: { start } as never });
    expect(await command.preview({ data: '@artifact:input' })).toMatchObject({ deferredArtifactInputs: true });
    const selection = { profileId: 'p', identity: 'user', accountId: 'a' }, grant = { id: 'g', profiles: [{ profileId: 'p', identities: ['user'], accounts: ['a'] }], domains: ['calendar'], permissions: ['read'], expiresAt: Date.now() + 3600000, revoked: false };
    const request = vi.fn(async () => ({ items: [1], has_more: false }));
    await command.execute({ 'page-all': true, 'page-limit': 2, 'page-delay': 17, data: { query: 'x' } }, { selection, grant, lark: { request } } as never);
    expect(start).toHaveBeenCalledWith('typed-api-calendar-read', expect.objectContaining({ plan: expect.objectContaining({ pageAll: true, pageLimit: 2, pageDelay: 17 }) }), selection, grant);
    expect(request).not.toHaveBeenCalled();
    const program = apiPrograms(descriptors)[0]!;
    expect(program).toMatchObject({ domain: 'calendar', risk: 'read' });
    expect(await program.step(start.mock.calls[0]![1], { selection, grant, lark: { request } } as never)).toMatchObject({ done: true, output: { items: [1] } });
});
it('maps output, formatting and jq options into the shared engine and supports dry-run', async () => {
    const [entry] = compileService({ name: 'drive', servicePath: '/open-apis/drive/v1', resources: { files: { methods: { get: { httpMethod: 'GET', path: 'files', risk: 'read' } } } } });
    const start = vi.fn(async (_id: string, _state: Record<string, unknown>, _selection: unknown, _grant: unknown) => ({})), request = vi.fn(), formatter = { process: vi.fn(async () => true) };
    const command = apiCapability(entry!, { workflows: { start } as never, formatter });
    const context = { grant: { id: 'g' }, selection: { profileId: 'p' }, lark: { request } } as never;
    await command.execute({ output: 'report.pdf' }, context);
    expect(start.mock.calls[0]![1]).toMatchObject({ plan: { output: 'report.pdf' } });
    await command.execute({ jq: '.data.items', json: true }, context);
    expect(formatter.process).toHaveBeenCalledWith({ operation: 'jq-validate', expression: '.data.items' });
    await expect(command.preview({ jq: '.', format: 'csv' })).rejects.toThrow();
    await command.execute({ 'dry-run': true }, context); expect(request).not.toHaveBeenCalled(); expect(start).toHaveBeenCalledTimes(2);
});
it('reserves actual standard flags while exposing other parameter names and list metadata', () => {
    const [entry] = compileService({ name: 'test', servicePath: '/open-apis/test/v1', resources: { items: { methods: { list: { httpMethod: 'GET', path: 'items', parameters: { profile: { type: 'string' }, format: { type: 'string' }, config: { type: 'string' }, ids: { type: 'list' } } } } } }});
    expect(entry!.parameterFlags).toMatchObject({ config: 'config', ids: 'ids' });
    expect(entry!.parameterFlags).not.toHaveProperty('profile'); expect(entry!.parameterFlags).not.toHaveProperty('format');
    expect(entry!.definition.inputSchema.properties).toMatchObject({ ids: { type: 'array', items: { type: 'string' } } });
});
it('preserves unusual unknown query keys as data instead of object prototype mutations', async () => {
    const [entry] = compileService({ name: 'test', servicePath: '/open-apis/test/v1', resources: { items: { methods: { list: { httpMethod: 'GET', path: 'items' } } } } });
    const preview = await apiCapability(entry!).preview({ params: '{"__proto__":"literal","constructor":0}' }) as { query: Record<string, unknown> };
    expect(Object.hasOwn(preview.query, '__proto__')).toBe(true);
    expect(preview.query.__proto__).toBe('literal'); expect(preview.query.constructor).toBe(0);
});

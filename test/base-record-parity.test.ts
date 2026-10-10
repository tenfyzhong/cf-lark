import { describe, expect, it, vi } from 'vitest';
import { recordReadCapabilities, recordReadPrograms } from '../src/capabilities/base/record-read';
import { prepareRecordRead } from '../src/capabilities/base/record-read-input';
import type { JsonObject } from '../src/domain/models';

const args = { 'base-token': 'b', 'table-id': 't' };
const searchArgs = { ...args, keyword: 'Launch', 'search-field': ['Title'] };
const getArgs = { ...args, 'record-id': ['rec_a', 'rec_b'] };
const page = { timezone: 'UTC', fields: ['Title'], field_id_list: ['f'], field_type_list: ['text'], record_id_list: ['rec_a'], data: [['Launch']], has_more: true };
function setup() {
    const request = vi.fn().mockResolvedValue(page);
    const start = vi.fn().mockResolvedValue({ workflowId: 'w', status: 'pending' });
    const capabilities = recordReadCapabilities({ workflows: { start, resume: vi.fn() } });
    const command = (action: string) => capabilities.find(value => value.definition.id === `base.+record-${action}`)!;
    const context = { lark: { request }, selection: { profileId: 'p', identity: 'user' as const, accountId: 'u' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', identities: ['user' as const], accounts: ['u'] }], domains: ['base', 'artifact'], permissions: ['read' as const, 'write' as const] } };
    return { request, start, command, context };
}

describe('Base record-read contract at upstream 9067ec079bfa0b1ae2266cd91d1c1ee4a1ce824d', () => {
    it.each([['get', getArgs], ['list', args], ['search', searchArgs]] as const)('defaults %s to NDJSON and advertises supported formats', async (action, input) => {
        const f = setup();
        const preview = await f.command(action).preview(input);
        expect(preview).toMatchObject({ format: 'ndjson', storage: 'private artifacts', page_size: action === 'get' ? 2 : 2000 });
        expect((f.command(action).definition.inputSchema.properties as JsonObject).format).toEqual({ enum: ['ndjson', 'json'], default: 'ndjson' });
        await f.command(action).execute(input, f.context);
        expect(f.start).toHaveBeenCalledOnce();
        expect(f.request).not.toHaveBeenCalled();
    });

    it.each([['get', getArgs], ['list', args], ['search', searchArgs]] as const)('rejects obsolete Markdown for %s before upstream I/O', async (action, input) => {
        const f = setup();
        await expect(f.command(action).preview({ ...input, format: 'markdown' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS', message: expect.stringMatching(/markdown.*no longer supported/i) });
        await expect(f.command(action).execute({ ...input, format: 'markdown' }, f.context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(f.request).not.toHaveBeenCalled();
        expect(f.start).not.toHaveBeenCalled();
    });

    it('rejects Markdown before deferring or resolving artifact input', async () => {
        const f = setup();
        const artifacts = { stat: vi.fn(), read: vi.fn(), upload: vi.fn(), remove: vi.fn() };
        const capability = recordReadCapabilities({ artifacts }).find(value => value.definition.id === 'base.+record-get')!;
        const input = { ...args, json: '@selected-records', format: 'markdown' };
        await expect(capability.preview(input)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(capability.execute(input, f.context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(artifacts.stat).not.toHaveBeenCalled();
        expect(artifacts.read).not.toHaveBeenCalled();
        expect(artifacts.upload).not.toHaveBeenCalled();
        expect(f.request).not.toHaveBeenCalled();
    });

    it.each(['list', 'search'])('preserves %s format-specific defaults, limits, and the page-size alias', action => {
        const input = action === 'search' ? searchArgs : args;
        expect(prepareRecordRead(action, input).limit).toBe(2000);
        expect(prepareRecordRead(action, { ...input, format: 'json' }).limit).toBe(action === 'list' ? 100 : 10);
        for (const limit of [1, 501, 2000]) expect(prepareRecordRead(action, { ...input, 'page-size': limit }).limit).toBe(limit);
        for (const limit of [0, 2001, 1.5]) expect(() => prepareRecordRead(action, { ...input, limit })).toThrow();
        expect(prepareRecordRead(action, { ...input, format: 'json', limit: 200 }).limit).toBe(200);
        expect(() => prepareRecordRead(action, { ...input, format: 'json', limit: 201 })).toThrow();
    });

    it('applies the NDJSON default and bounds to a JSON search body', () => {
        const input = { ...args, json: { keyword: 'Launch', search_fields: ['Title'] } };
        expect(prepareRecordRead('search', input).request.body).toMatchObject({ offset: 0, limit: 2000 });
        expect(prepareRecordRead('search', { ...input, json: { ...input.json, offset: 17, limit: 2000 } }).request.body).toMatchObject({ offset: 17, limit: 2000 });
        expect(() => prepareRecordRead('search', { ...input, json: { ...input.json, limit: 2001 } })).toThrow();
    });

    it.each(['list', 'search'])('requests one %s page at the supplied offset and full requested limit', async action => {
        const f = setup();
        const input = { ...(action === 'search' ? searchArgs : args), format: 'ndjson', offset: 17, limit: 2000 };
        await f.command(action).execute(input, f.context);
        const result = await recordReadPrograms()[0]!.step(f.start.mock.calls[0]![1], f.context);
        const sent = f.request.mock.calls[0]![0];
        expect(sent[action === 'list' ? 'query' : 'body']).toMatchObject({ offset: 17, limit: 2000 });
        expect(result).toMatchObject({ done: false, state: { phase: 'export', pages: [page] } });
        expect(f.request).toHaveBeenCalledOnce();
        expect(await f.command(action).preview(input)).toMatchObject({ page_size: 2000 });
    });

    it.each([0, 1, 2])('exports a %i-row page immediately even when the server has more', async count => {
        const f = setup();
        const data = { ...page, record_id_list: Array.from({ length: count }, (_, i) => `rec_${i}`), data: Array.from({ length: count }, () => ['Launch']) };
        f.request.mockResolvedValue(data);
        await f.command('list').execute({ ...args, format: 'ndjson', limit: 2 }, f.context);
        expect(await recordReadPrograms()[0]!.step(f.start.mock.calls[0]![1], f.context)).toMatchObject({ done: false, state: { phase: 'export', pages: [data] } });
        expect(f.request).toHaveBeenCalledOnce();
    });

    it.each([['get', getArgs], ['list', args], ['search', searchArgs]] as const)('returns the unchanged %s JSON matrix without export dependencies', async (action, input) => {
        const f = setup();
        const capability = recordReadCapabilities({}).find(value => value.definition.id === `base.+record-${action}`)!;
        expect(await capability.execute({ ...input, format: 'json' }, f.context)).toBe(page);
        expect(f.request).toHaveBeenCalledOnce();
    });

    it('versions the changed workflow contract', () => {
        expect(recordReadPrograms()[0]!.version).toBe(2);
    });
});

it.each(['get', 'search', 'empty-search'])('exports the %s one-page matrix with pinned continuation and selection metadata', async action => {
    const { readFile } = await import('node:fs/promises');
    const { WasmDocumentParser } = await import('../src/infrastructure/documents/engine');
    const parser = new WasmDocumentParser(await WebAssembly.compile(await readFile(new URL('../src/infrastructure/documents/generated/docs/parser.wasm', import.meta.url))));
    const f = setup(), bodies: string[] = [];
    const artifacts = { stat: vi.fn(), read: vi.fn(), remove: vi.fn(), upload: vi.fn(async (_owner: string, size: number, stream: ReadableStream) => {
        bodies.push(await new Response(stream).text());
        return { id: `a${bodies.length}`, owner: 'g', size, state: 'ready' as const, expiresAt: 1 };
    }) };
    const get = action === 'get', empty = action === 'empty-search';
    f.request.mockResolvedValue(empty ? { ...page, record_id_list: [], data: [] } : { ...page, has_more: !get });
    const input = get ? { ...getArgs, 'field-id': ['Title'] } : { ...searchArgs, offset: 17, limit: 2000 };
    const capability = recordReadCapabilities({ workflows: { start: f.start, resume: vi.fn() }, artifacts, recordFormatter: parser }).find(value => value.definition.id === `base.+record-${get ? 'get' : 'search'}`)!;
    await capability.execute(input, f.context);
    const program = recordReadPrograms(artifacts, parser)[0]!;
    const read = await program.step(f.start.mock.calls[0]![1], f.context);
    expect(read.done).toBe(false);
    if (read.done) throw new Error('Expected an export checkpoint.');
    expect(read.state.phase).toBe('export');
    const exported = await program.step(read.state, f.context);
    expect(exported).toMatchObject({ done: true, output: { records_count: empty ? 0 : 1, has_more: !get, ...(get ? {} : { next_offset: empty ? 17 : 18 }) } });
    expect(f.request).toHaveBeenCalledOnce();
    expect(artifacts.upload).toHaveBeenCalledTimes(2);
    const manifest = JSON.parse(bodies[1]!);
    if (get) {
        expect(f.request.mock.calls[0]![0].body).toEqual({ record_id_list: ['rec_a', 'rec_b'], select_fields: ['Title'] });
        expect(manifest).toMatchObject({ query_context: { record_scope: 'selected_record_ids', requested_record_count: 2 } });
        expect(manifest).not.toHaveProperty('next_offset');
    } else {
        expect(f.request.mock.calls[0]![0].body).toMatchObject({ offset: 17, limit: 2000 });
        expect(manifest).toMatchObject({ offset: 17, requested_limit: 2000, next_offset: empty ? 17 : 18 });
    }
});

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
    const process = vi.fn().mockResolvedValue('Rendered Markdown');
    const capabilities = recordReadCapabilities({ workflows: { start, resume: vi.fn() }, recordFormatter: { process } });
    const command = (action: string) => capabilities.find(value => value.definition.id === `base.+record-${action}`)!;
    const context = { lark: { request }, selection: { profileId: 'p', identity: 'user' as const, accountId: 'u' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', identities: ['user' as const], accounts: ['u'] }], domains: ['base', 'artifact'], permissions: ['read' as const, 'write' as const] } };
    return { request, start, process, command, context };
}

describe('Base hosted read compatibility and explicit NDJSON one-page contract', () => {
    it.each([['get', getArgs], ['list', args], ['search', searchArgs]] as const)('defaults %s to inline Markdown with a Base-only read grant', async (action, input) => {
        const f = setup();
        f.context.grant.domains = ['base'];
        f.context.grant.permissions = ['read'];
        const preview = await f.command(action).preview(input);
        expect(preview).toMatchObject({ format: 'markdown' });
        expect(preview).not.toHaveProperty('storage');
        expect((f.command(action).definition.inputSchema.properties as JsonObject).format).toMatchObject({ enum: ['markdown', 'json', 'ndjson'], default: 'markdown' });
        expect(await f.command(action).execute(input, f.context)).toEqual({ markdown: 'Rendered Markdown' });
        expect(f.process).toHaveBeenCalledExactlyOnceWith({ operation: 'markdown', data: page, get: action === 'get' });
        expect(f.request).toHaveBeenCalledOnce();
        expect(f.start).not.toHaveBeenCalled();
    });

    it.each([['get', getArgs], ['list', args], ['search', searchArgs]] as const)('accepts explicit Markdown for %s without artifact or workflow dependencies', async (action, input) => {
        const f = setup();
        f.context.grant.domains = ['base'];
        f.context.grant.permissions = ['read'];
        const capability = recordReadCapabilities({ recordFormatter: { process: f.process } }).find(value => value.definition.id === `base.+record-${action}`)!;
        expect(await capability.preview({ ...input, format: 'markdown' })).toMatchObject({ format: 'markdown' });
        expect(await capability.execute({ ...input, format: 'markdown' }, f.context)).toEqual({ markdown: 'Rendered Markdown' });
        expect(f.process).toHaveBeenCalledExactlyOnceWith({ operation: 'markdown', data: page, get: action === 'get' });
        expect(f.request).toHaveBeenCalledOnce();
    });

    it.each([['get', getArgs], ['list', args], ['search', searchArgs]] as const)('preserves the %s raw-matrix fallback when Markdown rendering fails', async (action, input) => {
        const f = setup();
        f.context.grant.domains = ['base'];
        f.context.grant.permissions = ['read'];
        f.process.mockRejectedValue(new Error('Invalid record matrix'));
        expect(await f.command(action).execute(input, f.context)).toEqual({ ...page, _notice: 'Record Markdown rendering failed; returning the original matrix.' });
        expect(f.request).toHaveBeenCalledOnce();
        expect(f.start).not.toHaveBeenCalled();
    });

    it.each([['get', getArgs], ['list', args], ['search', searchArgs]] as const)('keeps explicit NDJSON and implicit output exports for %s', async (action, input) => {
        for (const exportArgs of [{ format: 'ndjson' }, { output: 'records.ndjson' }]) {
            const f = setup();
            expect(await f.command(action).preview({ ...input, ...exportArgs })).toMatchObject({ format: 'ndjson', storage: 'private artifacts', page_size: action === 'get' ? 2 : 2000 });
            expect(await f.command(action).execute({ ...input, ...exportArgs }, f.context)).toEqual({ workflowId: 'w', status: 'pending' });
            expect(f.start).toHaveBeenCalledOnce();
            expect(f.start.mock.calls[0]![1]).toMatchObject({ plan: { format: 'ndjson' }, phase: 'read' });
            expect(f.request).not.toHaveBeenCalled();
            expect(f.process).not.toHaveBeenCalled();
        }
    });

    it.each([{ domains: ['base'] }, { domains: ['base', 'artifact'] }])('still requires artifact-write permission for NDJSON exports with domains $domains', async ({ domains }) => {
        const f = setup();
        f.context.grant.domains = domains;
        f.context.grant.permissions = ['read'];
        await expect(f.command('list').execute({ ...args, format: 'ndjson' }, f.context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(f.request).not.toHaveBeenCalled();
        expect(f.start).not.toHaveBeenCalled();
    });

    it('rejects an unsupported format before deferring or resolving artifact input', async () => {
        const f = setup();
        const artifacts = { stat: vi.fn(), read: vi.fn(), upload: vi.fn(), remove: vi.fn() };
        const capability = recordReadCapabilities({ artifacts }).find(value => value.definition.id === 'base.+record-get')!;
        const input = { ...args, json: '@selected-records', format: 'csv' };
        await expect(capability.preview(input)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(capability.execute(input, f.context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(artifacts.stat).not.toHaveBeenCalled();
        expect(artifacts.read).not.toHaveBeenCalled();
        expect(artifacts.upload).not.toHaveBeenCalled();
        expect(f.request).not.toHaveBeenCalled();
    });

    it('resolves Markdown artifact input with read permission without exporting', async () => {
        const f = setup();
        f.context.grant.permissions = ['read'];
        const artifacts = { stat: vi.fn().mockResolvedValue({ size: 30 }), read: vi.fn().mockResolvedValue(new Response(JSON.stringify({ record_id_list: ['rec_a'] }))), upload: vi.fn(), remove: vi.fn() };
        const capability = recordReadCapabilities({ artifacts, recordFormatter: { process: f.process } }).find(value => value.definition.id === 'base.+record-get')!;
        const input = { ...args, json: '@selected-records', format: 'markdown' };
        expect(await capability.preview(input)).toMatchObject({ deferredArtifactValidation: true, requests: [] });
        expect(await capability.execute(input, f.context)).toEqual({ markdown: 'Rendered Markdown' });
        expect(artifacts.stat).toHaveBeenCalledExactlyOnceWith('g', 'selected-records');
        expect(artifacts.read).toHaveBeenCalledExactlyOnceWith('g', 'selected-records');
        expect(artifacts.upload).not.toHaveBeenCalled();
        expect(f.request).toHaveBeenCalledOnce();
    });

    it.each(['list', 'search'])('preserves %s format-specific defaults, limits, and the page-size alias', action => {
        const input = action === 'search' ? searchArgs : args;
        const inlineDefault = action === 'list' ? 100 : 10;
        for (const format of [undefined, 'markdown', 'json']) {
            expect(prepareRecordRead(action, { ...input, format }).limit).toBe(inlineDefault);
            for (const limit of [1, 200]) expect(prepareRecordRead(action, { ...input, format, 'page-size': limit }).limit).toBe(limit);
            for (const limit of [0, 201, 1.5]) expect(() => prepareRecordRead(action, { ...input, format, limit })).toThrow();
        }
        expect(prepareRecordRead(action, { ...input, format: 'ndjson' }).limit).toBe(2000);
        for (const limit of [1, 501, 2000]) expect(prepareRecordRead(action, { ...input, format: 'ndjson', 'page-size': limit }).limit).toBe(limit);
        for (const limit of [0, 2001, 1.5]) expect(() => prepareRecordRead(action, { ...input, format: 'ndjson', limit })).toThrow();
    });

    it('preserves format-specific defaults and bounds with a JSON search body', () => {
        const input = { ...args, json: { keyword: 'Launch', search_fields: ['Title'] } };
        for (const format of [undefined, 'markdown', 'json']) {
            expect(prepareRecordRead('search', { ...input, format }).request.body).toMatchObject({ offset: 0, limit: 10 });
            expect(prepareRecordRead('search', { ...input, format, json: { ...input.json, offset: 17, limit: 200 } }).request.body).toMatchObject({ offset: 17, limit: 200 });
            expect(() => prepareRecordRead('search', { ...input, format, json: { ...input.json, limit: 201 } })).toThrow();
        }
        expect(prepareRecordRead('search', { ...input, format: 'ndjson' }).request.body).toMatchObject({ offset: 0, limit: 2000 });
        expect(prepareRecordRead('search', { ...input, format: 'ndjson', json: { ...input.json, offset: 17, limit: 2000 } }).request.body).toMatchObject({ offset: 17, limit: 2000 });
        expect(() => prepareRecordRead('search', { ...input, format: 'ndjson', json: { ...input.json, limit: 2001 } })).toThrow();
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
    await capability.execute({ ...input, format: 'ndjson' }, f.context);
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

import { expect, it, vi } from 'vitest';
import { recordReadCapabilities } from '../src/capabilities/base/record-read';
const dependencies = { workflows: { start: vi.fn(), resume: vi.fn() } };
const command = (suffix: string) => recordReadCapabilities(dependencies).find(item => item.definition.id === `base.+record-${suffix}`)!;
it('previews list projection, filter and ordered sort without upstream I/O', async () => {
    const result = await command('list').preview({ 'base-token': 'base', 'table-id': 'Table/name', 'field-id': ['Title', 'Status'], 'filter-json': { logic: 'and', conditions: [] }, 'sort-json': [{ field: 'Title', desc: false }], format: 'json' });
    expect(result).toMatchObject({ request: { method: 'GET', path: '/open-apis/base/v3/bases/base/tables/Table%2Fname/records', query: { field_id: ['Title', 'Status'], filter: '{"logic":"and","conditions":[]}', sort: '[{"field":"Title","desc":false}]', offset: 0, limit: 100 } } });
});
it('rejects incompatible selection and export flags before starting work', async () => {
    await expect(command('get').preview({ 'base-token': 'b', 'table-id': 't', 'record-id': ['r'], json: { record_id_list: ['r'] } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(command('list').preview({ 'base-token': 'b', 'table-id': 't', output: 'rows.csv' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(command('search').preview({ 'base-token': 'b', 'table-id': 't', keyword: 'A', json: { keyword: 'B' } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});

it('exports exact typed matrices and schema metadata through the pinned engine', async () => {
    const { readFile } = await import('node:fs/promises');
    const { WasmDocumentParser } = await import('../src/infrastructure/documents/engine');
    const parser = new WasmDocumentParser(await WebAssembly.compile(await readFile(new URL('../src/infrastructure/documents/generated/docs/parser.wasm', import.meta.url))));
    const page = { timezone: 'UTC', fields: ['Name', 'Score', 'Done'], field_id_list: ['f1', 'f2', 'f3'], field_type_list: ['text', 'number', 'checkbox'], record_id_list: ['rec_a', 'rec_b'], data: [['A', 2, true], ['B', 4, null]], has_more: true, rev: 7 };
    const result = await parser.process({ operation: 'export', pages: [page], options: { BaseToken: 'b', TableID: 't', Offset: 10, RequestedLimit: 2 } }) as { ndjson: string; manifest: unknown; records: unknown[] };
    expect(result.records).toEqual([{ record_id: 'rec_a', Name: 'A', Score: 2, Done: true }, { record_id: 'rec_b', Name: 'B', Score: 4, Done: false }]);
    expect(result.manifest).toMatchObject({ records_count: 2, has_more: true, next_offset: 12, columns: { Score: { stats: { min: 2, max: 4, avg: 3 } } } });
    expect(result.ndjson.split('\n').filter(Boolean)).toHaveLength(2);
    await expect(parser.process({ operation: 'export', pages: [page, { ...page, timezone: 'Asia/Shanghai' }] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(await parser.process({ operation: 'markdown', data: { ...page, record_id_list: ['rec_a'], data: [['A', 2, true]] }, get: true })).toContain('- `_record_id`: rec_a');
});

it('exports one short page with continuation metadata and leaves artifacts unchanged when applying jq', async () => {
    const { recordReadPrograms } = await import('../src/capabilities/base/record-read');
    const { readFile } = await import('node:fs/promises');
    const { WasmDocumentParser } = await import('../src/infrastructure/documents/engine');
    const parser = new WasmDocumentParser(await WebAssembly.compile(await readFile(new URL('../src/infrastructure/documents/generated/docs/parser.wasm', import.meta.url))));
    const page = { timezone: 'UTC', fields: ['Score'], field_id_list: ['f1'], field_type_list: ['number'], record_id_list: ['rec_a'], data: [[2]], has_more: true };
    const request = vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce({ ...page, record_id_list: ['rec_b'], data: [[4]], has_more: false });
    const bodies: string[] = [];
    const artifacts = { upload: vi.fn(async (_owner: string, size: number, stream: ReadableStream) => { bodies.push(await new Response(stream).text()); return { id: `a${bodies.length}`, owner: 'g', size, state: 'ready' as const, expiresAt: 1 }; }), stat: vi.fn(), read: vi.fn(), remove: vi.fn() };
    const context = { lark: { request }, selection: { profileId: 'p', identity: 'user' as const, accountId: 'u' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', identities: ['user' as const], accounts: ['u'] }], domains: ['base', 'artifact'], permissions: ['read' as const, 'write' as const] } };
    const start = vi.fn();
    await recordReadCapabilities({ workflows: { start, resume: vi.fn() }, artifacts, recordFormatter: parser }).find(item => item.definition.id === 'base.+record-list')!.execute({ 'base-token': 'b', 'table-id': 't', format: 'ndjson', offset: 17, limit: 2000, 'jq-records': 'map(.Score) | add' }, context);
    let state = start.mock.calls[0]![1], output: unknown;
    for (let i = 0; i < 5; i++) { const result = await recordReadPrograms(artifacts, parser)[0]!.step(state, context); if (result.done) { output = result.output; break; } state = result.state; }
    expect(request.mock.calls.map(call => call[0].query)).toEqual([{ offset: 17, limit: 2000 }]);
    expect(output).toMatchObject({ records_count: 1, has_more: true, jq_records: [2], record_artifact_id: 'a1', manifest_artifact_id: 'a2' });
    expect(bodies[0]).toContain('"Score":2'); expect(bodies[0]).not.toContain('"Score":4');
    expect(JSON.parse(bodies[1]!)).toMatchObject({ records_count: 1, has_more: true, next_offset: 18 });
});

it('preserves JSON search overrides and rejects projection ambiguity', async () => {
    const result = await command('search').preview({ 'base-token': 'b', 'table-id': 't', json: { keyword: 'A', search_fields: ['Name'], select_fields: null, sort: { sort_config: [{ field: 'Old' }] } }, 'filter-json': { logic: 'and' }, 'sort-json': [{ field: 'New' }], format: 'ndjson' });
    expect(result).toMatchObject({ request: { body: { keyword: 'A', search_fields: ['Name'], sort: [{ field: 'New' }], filter: { logic: 'and' }, offset: 0, limit: 2000 } } });
    await expect(command('get').preview({ 'base-token': 'b', 'table-id': 't', json: { record_id_list: ['r'], select_fields: ['A'] }, 'field-id': ['B'] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(command('get').preview({ 'base-token': 'b', 'table-id': 't', 'record-id': ['r', 'r'] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(await command('list').preview({ 'base-token': 'b', 'table-id': 't', 'field-names': '"Name, full",Status', format: 'json', offset: -1 })).toMatchObject({ request: { query: { field_id: ['Name, full', 'Status'], offset: 0 } } });
});

it('rejects malformed matrices and oversized server pages before artifact writes', async () => {
    const { recordReadPrograms } = await import('../src/capabilities/base/record-read');
    const { prepareRecordRead } = await import('../src/capabilities/base/record-read-input');
    const page = { timezone: 'UTC', fields: ['A'], field_id_list: ['f'], field_type_list: ['text'], record_id_list: ['r'], data: [['A']], has_more: true };
    const request = vi.fn(async () => ({ ...page, record_id_list: ['a', 'b'] }));
    const context = { lark: { request }, selection: { profileId: 'p', identity: 'bot' as const }, grant: { id: 'g', expiresAt: 1, revoked: false, profiles: [], domains: [], permissions: [] } };
    const plan = prepareRecordRead('list', { 'base-token': 'b', 'table-id': 't', format: 'ndjson', limit: 1 });
    await expect(recordReadPrograms()[0]!.step({ plan, pages: [], phase: 'read' }, context)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    request.mockResolvedValueOnce({ ...page, record_id_list: ['a', 'b'], data: [['A'], ['B']] });
    await expect(recordReadPrograms()[0]!.step({ plan, pages: [], phase: 'read' }, context)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
});

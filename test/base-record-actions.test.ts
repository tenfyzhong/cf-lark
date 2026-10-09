import { expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import type { CommandContext } from '../src/ports/capabilities';
const args = { 'base-token': 'b', 'table-id': 't' };
function command(name: string) { return baseCapabilities().find(c => c.definition.id === `base.+${name}`)!; }
function fixture(data: unknown = {}) { const request = vi.fn().mockResolvedValue(data); return { request, context: { lark: { request } } as unknown as CommandContext }; }
it('deletes exactly the normalized record selection', async () => {
    const f = fixture({ deleted: 2 });
    expect(await command('record-delete').execute({ ...args, json: { record_id_list: [' r1 ', 'r2'] } }, f.context)).toEqual({ deleted: 2 });
    expect(f.request.mock.calls[0]![0].body).toEqual({ record_id_list: ['r1', 'r2'] });
    for (const input of [{ 'record-id': ['r', ' r '] }, { 'record-id': [] }, { 'record-id': ['r'], json: { record_id_list: ['x'] } }, { 'record-id': Array(201).fill('r') }]) await expect(command('record-delete').preview({ ...args, ...input })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('deduplicates share requests and preserves inaccessible-record omissions', async () => {
    const f = fixture({ record_share_links: { r1: 'https://example.com' } });
    expect(await command('record-share-link-create').execute({ ...args, 'record-ids': ['r1', 'r2', 'r1', ''] }, f.context)).toEqual({ record_share_links: { r1: 'https://example.com' } });
    expect(f.request.mock.calls[0]![0].body).toEqual({ record_ids: ['r1', 'r2'] });
});
it('preserves record history cursors and validates explicit bounds', async () => {
    const f = fixture({ items: [] });
    await command('record-history-list').execute({ ...args, 'record-id': 'r', 'max-version': 42 }, f.context);
    expect(f.request.mock.calls[0]![0]).toEqual({ method: 'GET', path: '/open-apis/base/v3/bases/b/record_history', query: { table_id: 't', record_id: 'r', page_size: 30, max_version: 42 } });
    for (const input of [{ 'page-size': 51 }, { 'max-version': 0 }]) await expect(command('record-history-list').preview({ ...args, 'record-id': 'r', ...input })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it.each(['create', 'update'])('preserves batch record %s payloads', async action => {
    const f = fixture({ ignored_fields: [] });
    const json = action === 'create' ? { create_records: [{ Name: 'One' }] } : { update_records: { r1: { Name: 'One' } } };
    expect(await command(`record-batch-${action}`).execute({ ...args, json }, f.context)).toEqual({ ignored_fields: [] });
    expect(f.request.mock.calls[0]![0]).toEqual({ method: 'POST', path: `/open-apis/base/v3/bases/b/tables/t/records/batch_${action}`, body: json });
});
it('upserts only by an explicit record ID and keeps top-level fields', async () => {
    const f = fixture({ id: 'r' });
    expect(await command('record-upsert').execute({ ...args, json: { Name: 'One' } }, f.context)).toEqual({ record: { id: 'r' }, created: true });
    expect(await command('record-upsert').execute({ ...args, 'record-id': 'r/a', json: { Name: 'Two' } }, f.context)).toEqual({ record: { id: 'r' }, updated: true });
    expect(f.request.mock.calls[1]![0]).toEqual({ method: 'PATCH', path: '/open-apis/base/v3/bases/b/tables/t/records/r%2Fa', body: { Name: 'Two' } });
});

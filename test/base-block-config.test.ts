import { expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import { basePrograms } from '../src/capabilities/base/programs';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
const args = { 'base-token': 'b', 'dashboard-id': 'd', 'block-id': 'x', name: ' Chart ' };
const command = (name: string) => baseCapabilities().find(c => c.definition.id === `base.+${name}`)!;
it('normalizes dashboard ranking defaults and preserves an explicit false validation bypass', async () => {
    const result = await command('dashboard-block-create').preview({ ...args, type: 'ranking', 'data-config': { table_name: 'Orders', count_all: true, group_by: [{ field_name: 'Owner' }] } }) as { requests: Array<{body: unknown}> };
    expect(result.requests[0]!.body).toEqual({ name: 'Chart', type: 'ranking', data_config: { table_name: 'Orders', count_all: true, group_by: [{ field_name: 'Owner', sort: { type: 'value', order: 'desc' } }], limit_size: 10 } });
});
it.each([
    { type: 'text' },
    { type: 'nps', 'data-config': { table_name: 'T', count_all: false, group_by: [{ field_name: 'Score' }] } },
    { type: 'statistics', 'data-config': { table_name: 'T', count_all: true, number_format: { precision: 10 } } },
    { type: 'column', position: { x: 1, y: 2, w: 3 } },
    { type: 'ranking', 'data-config': { table_name: 'T', count_all: true, group_by: [{ field_name: 'Owner' }], unexpected: 1 } },
])('rejects invalid dashboard block configuration %j', async input => {
    await expect(command('dashboard-block-create').preview({ ...args, ...input })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('allows dashboard partial patches and bypasses semantic validation without bypassing JSON syntax', async () => {
    const result = await command('dashboard-block-update').preview({ ...args, 'data-config': { text: 'hello' }, position: { x: -1, y: 0, w: 1, h: 1 } }) as {requests: Array<{body: unknown}>};
    expect(result.requests[0]!.body).toEqual({ name: 'Chart', data_config: { text: 'hello' }, position: { x: -1, y: 0, w: 1, h: 1 } });
    await expect(command('dashboard-block-create').preview({ ...args, type: 'text', 'no-validate': true, 'data-config': '{bad' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
async function run(name: string, a: JsonObject, replies: JsonObject[]) {
    const request = vi.fn(); for (const reply of replies) request.mockResolvedValueOnce(reply);
    let state: JsonObject = { args: a, phase: 'start' };
    const program = basePrograms().find(p => p.id === `base-${name}`)!;
    for (let i = 0; i < 20; i++) {
        const step = await program.step(state, { lark: { request } } as unknown as CommandContext);
        if (step.done) return { request, output: step.output };
        state = step.state;
    }
    throw new Error('Workflow did not finish');
}
it('checks every app block page and workspace before creating list blocks', async () => {
    const f = await run('app-block-create', { 'app-token': 'a', 'page-id': 'p', name: 'Tasks', type: 'list', 'data-config': { base_token: 'b', table_name: 'Tasks' } }, [
        { items: [], has_more: true, page_token: 'next' }, { widgets: [] }, { workspace_token: 'w' }, { items: [], has_more: true, page_token: 'next' }, { entities: [{ entity_token: 'b' }] }, { block_id: 'new' },
    ]);
    expect(f.output).toEqual({ block: { block_id: 'new' }, created: true });
    expect(f.request.mock.calls.at(-1)![0].body).toEqual({ name: 'Tasks', type: 'list', sub_type: 'standard', data_config: { base_token: 'b', table_name: 'Tasks' } });
    expect(f.request.mock.calls[1]![0].query.page_token).toBe('next');
});
it('rejects duplicate app names before writes', async () => {
    await expect(run('app-block-create', { 'app-token': 'a', 'page-id': 'p', name: 'Chart', type: 'text' }, [{ blocks: [{ name: ' chart ' }] }])).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('validates merged app chart config while sending only the patch', async () => {
    const f = await run('app-block-update', { 'app-token': 'a', 'page-id': 'p', 'block-id': 'x', 'data-config': { data_sources: [{ table_name: 'T', series: [{ field_name: 'Price', rollup: 'sum' }] }] } }, [{ type: 'column', data_config: { base_token: 'b', data_sources: [{ table_name: 'Old', count_all: true }] } }, { id: 'x' }]);
    expect(f.request.mock.calls[1]![0].body).toEqual({ data_config: { data_sources: [{ table_name: 'T', series: [{ field_name: 'Price', rollup: 'SUM' }] }] } });
});
it.each([
    { type: 'statistics', 'data-config': { base_token: 'b', data_sources: [{ table_name: 'T', count_all: true, group_by: [{ field_name: 'Owner' }] }] } },
    { type: 'list', 'data-config': { base_token: 'b', table_name: 'T', columns: [{ type: 'combined', field_names: [] }] } },
    { type: 'text', 'data-config': { text: 'x', table_name: 'T' } },
])('rejects app configuration before starting %j', async input => {
    await expect(command('app-block-create').preview({ 'app-token': 'a', 'page-id': 'p', name: 'n', ...input })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('rejects null app patches even deeply nested', async () => {
    await expect(command('app-block-update').preview({ 'app-token': 'a', 'page-id': 'p', 'block-id': 'x', 'data-config': { text: null } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});

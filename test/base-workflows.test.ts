import { expect, it, vi } from 'vitest';
import { basePrograms } from '../src/capabilities/base/programs';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
async function run(name: string, args: JsonObject, responses: unknown[]) {
    const request = vi.fn(); responses.forEach(response => request.mockResolvedValueOnce(response));
    const program = basePrograms().find(p => p.id === `base-${name}`)!;
    let state: JsonObject = { args, phase: 'start' };
    for (let count = 0; count < 20; count++) {
        const before = request.mock.calls.length;
        const result = await program.step(state, { lark: { request } } as unknown as CommandContext);
        expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
        if (result.done) return { output: result.output, request };
        state = result.state;
    }
    throw new Error('Workflow did not terminate.');
}
it('inspects table metadata and all field and view pages', async () => {
    const fields = Array.from({ length: 100 }, (_, i) => ({ id: `f${i}` }));
    const result = await run('table-get', { 'base-token': 'b', 'table-id': 't' }, [{ id: 't' }, { fields, total: 101 }, { fields: [{ id: 'last' }], total: 101 }, { views: [{ id: 'v' }] }]);
    expect(result.output).toEqual({ table: { id: 't' }, fields: [...fields, { id: 'last' }], views: [{ id: 'v' }] });
    expect(result.request.mock.calls[2]![0].query).toEqual({ offset: 100, limit: 100 });
});
it('creates table then its requested views without replay', async () => {
    const result = await run('table-create', { 'base-token': 'b', name: 'Tasks', fields: [{ name: 'Title', type: 'text' }], view: [{ name: 'Grid' }, { name: 'Board' }] }, [{ id: 't', fields: [{ id: 'f' }] }, { id: 'v1' }, { id: 'v2' }]);
    expect(result.output).toEqual({ table: { id: 't', fields: [{ id: 'f' }] }, fields: [{ id: 'f' }], views: [{ id: 'v1' }, { id: 'v2' }] });
    expect(result.request.mock.calls.map(c => c[0].method)).toEqual(['POST', 'POST', 'POST']);
    expect(result.request.mock.calls[1]![0].path.endsWith('/tables/t/views')).toBe(true);
});
it('creates zero or multiple views with the upstream envelope', async () => {
    expect((await run('view-create', { 'base-token': 'b', 'table-id': 't', json: [] }, [])).output).toEqual({ views: [] });
    expect((await run('view-create', { 'base-token': 'b', 'table-id': 't', json: [{ name: 'Grid' }, { name: 'Board' }] }, [{ id: '1' }, { id: '2' }])).output).toEqual({ views: [{ id: '1' }, { id: '2' }] });
});
it('aggregates workflow pages and preserves status filters', async () => {
    const result = await run('workflow-list', { 'base-token': 'b', status: 'enabled' }, [{ items: [{ id: 'w1' }], has_more: true, page_token: 'next' }, { items: [{ id: 'w2' }], has_more: false }]);
    expect(result.output).toEqual({ items: [{ id: 'w1' }, { id: 'w2' }], total: 2 });
    expect(result.request.mock.calls[1]![0].body).toEqual({ page_size: 100, status: 'enabled', page_token: 'next' });
});
it.each(['create', 'update'])('checks every existing page before page %s', async action => {
    const result = await run(`app-page-${action}`, { 'app-token': 'a', 'page-id': 'p', name: ' Unique ' }, [{ items: [{ id: 'old', name: 'Old' }], has_more: true, next_page_token: 'next' }, { pages: [{ id: 'p', name: action === 'update' ? 'Unique' : 'Other' }], has_more: false }, { id: 'new' }]);
    expect(result.output).toEqual({ page: { id: 'new' }, [action === 'create' ? 'created' : 'updated']: true });
    expect(result.request.mock.calls[1]![0].query.page_token).toBe('next');
});
it('rejects duplicate page names before writes and invalid field schemas', async () => {
    await expect(run('app-page-create', { 'app-token': 'a', name: 'Unique' }, [{ pages: [{ id: 'p', name: ' UNIQUE ' }] }])).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(run('table-create', { 'base-token': 'b', name: 'Tasks', fields: [] }, [])).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});

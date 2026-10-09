import { expect, it, vi } from 'vitest';
import { basePrograms } from '../src/capabilities/base/programs';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
async function run(url: string, responses: unknown[] = []) {
    const request = vi.fn(); responses.forEach(data => request.mockResolvedValueOnce(data));
    const program = basePrograms().find(p => p.id === 'base-url-resolve')!;
    let state: JsonObject = { args: { url }, phase: 'start' };
    for (let i = 0; i < 10; i++) { const before = request.mock.calls.length; const result = await program.step(state, { lark: { request } } as unknown as CommandContext); expect(request.mock.calls.length - before).toBeLessThanOrEqual(1); if (result.done) return { output: result.output, request }; state = result.state; }
    throw new Error('URL resolution did not finish.');
}
it('resolves local app and form share coordinates without network', async () => {
    const app = await run('https://example.com/app/a?pageId=p&pre_pathname=%2Fbase%2Fworkspace%2Fw');
    expect(app.output).toMatchObject({ input_type: 'baseapp_url', app_token: 'a', page_id: 'p', workspace_token: 'w' }); expect(app.request).not.toHaveBeenCalled();
    expect((await run('https://example.com/share/base/form/s')).output).toMatchObject({ resource_type: 'bitable_form', share_token: 's' });
});
it('does not mistake a selected dashboard for a table', async () => {
    const result = await run('https://example.com/base/b?table=d&view=v&record=r', [{ blocks: [{ id: 'd', type: 'dashboard', name: 'Dashboard' }] }]);
    expect(result.output).toMatchObject({ block_id: 'd', block_type: 'dashboard', dashboard_id: 'd' });
    expect(result.output).not.toHaveProperty('table_id'); expect(result.output).not.toHaveProperty('view_id');
});
it('resolves Wiki Base and enriches confirmed table fields', async () => {
    const result = await run('https://example.com/wiki/w?table=t&view=v&record=r', [{ node: { obj_type: 'bitable', obj_token: 'b', title: 'Base' } }, { blocks: [{ id: 't', type: 'table', name: 'Tasks' }] }, { fields: [{ id: 'f' }], total: 1 }]);
    expect(result.output).toMatchObject({ input_type: 'wiki_url', wiki_node_token: 'w', base_token: 'b', table_id: 't', view_id: 'v', record_id: 'r', hint: { fields: { fields: [{ id: 'f' }], total: 1 } } });
});
it('rejects unsupported share paths and non-Base wiki resources', async () => {
    await expect(run('https://example.com/share/base/view/v')).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(run('https://example.com/wiki/w', [{ node: { obj_type: 'docx', obj_token: 'd' } }])).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('resolves record share metadata and projects row values by field ID', async () => {
    const result = await run('https://example.com/record/s', [{ base_token: 'b', table_id: 't', record_id: 'r' }, { field_id_list: ['f'], fields: ['Title'], data: [['Task']] }, { fields: [{ id: 'f' }], total: 1 }]);
    expect(result.output).toMatchObject({ record_share_token: 's', record_id: 'r', hint: { record_data: { f: 'Task' }, fields: { total: 1 } } });
});

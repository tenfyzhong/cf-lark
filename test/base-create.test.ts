import { expect, it, vi } from 'vitest';
import { basePrograms } from '../src/capabilities/base/programs';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
async function run(name: string, args: JsonObject, responses: unknown[], bot = false) {
    const request = vi.fn(); responses.forEach(data => request.mockResolvedValueOnce(data));
    const context = { lark: { request }, selection: { profileId: 'p', identity: bot ? 'bot' : 'user' }, grant: { profiles: [{ profileId: 'p', accounts: ['ou_user'] }] } } as unknown as CommandContext;
    const program = basePrograms().find(p => p.id === `base-${name}`)!;
    let state: JsonObject = { args, phase: 'start' };
    for (let i = 0; i < 15; i++) { const result = await program.step(state, context); if (result.done) return { output: result.output, request }; state = result.state; }
    throw new Error('Base creation did not finish.');
}
it('creates a Base then replaces only the default table', async () => {
    const result = await run('base-create', { name: 'Base', 'table-name': 'Tasks', fields: [{ name: 'Title', type: 'text' }] }, [{ base_token: 'b', default_table_id: 'old' }, { id: 'new', fields: [{ id: 'f' }] }, {}]);
    expect(result.output).toMatchObject({ created: true, table: { id: 'new' }, default_table_deleted: true, deleted_default_table_id: 'old' });
    expect(result.request.mock.calls.map(c => c[0].method)).toEqual(['POST', 'POST', 'DELETE']);
    expect(result.request.mock.calls[2]![0].path).toBe('/open-apis/base/v3/bases/b/tables/old');
});
it('discovers and renames the default table without deleting it', async () => {
    const result = await run('base-create', { name: 'Base', 'table-name': 'Tasks' }, [{ app_token: 'b' }, { tables: [{ table_id: 'old' }] }, { id: 'old', name: 'Tasks' }]);
    expect(result.output).toMatchObject({ default_table_renamed: true, renamed_default_table_id: 'old' });
    expect(result.request.mock.calls.map(c => c[0].method)).toEqual(['POST', 'GET', 'PATCH']);
});
it('copies with requested options and grants the authorized bot account', async () => {
    const result = await run('base-copy', { 'base-token': 'original', name: ' Copy ', 'without-content': true, 'time-zone': ' UTC ' }, [{ base_token: 'new' }, {}], true);
    expect(result.request.mock.calls[0]![0].body).toEqual({ name: 'Copy', without_content: true, time_zone: 'UTC' });
    expect(result.request.mock.calls[1]![0]).toMatchObject({ method: 'POST', query: { type: 'bitable', need_notification: false }, body: { member_id: 'ou_user', perm: 'full_access' } });
    expect(result.output).toMatchObject({ copied: true, permission_grant: { status: 'granted', user_open_id: 'ou_user' } });
});
it('validates malformed custom schemas before creating a Base', async () => {
    await expect(run('base-create', { name: 'Base', fields: [null] }, [])).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('ignores blank fields without renaming the default table', async () => {
    const result = await run('base-create', { name: 'Base', fields: '' }, [{ base_token: 'b' }]);
    expect(result.request).toHaveBeenCalledTimes(1);
    expect(result.output).toMatchObject({ created: true });
});

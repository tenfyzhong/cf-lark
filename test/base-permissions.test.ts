import { expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import type { CommandContext } from '../src/ports/capabilities';
function command(name: string) { return baseCapabilities().find(c => c.definition.id === `base.+${name}`)!; }
function fixture(data: unknown) { const request = vi.fn().mockResolvedValue(data); return { request, context: { lark: { request } } as unknown as CommandContext }; }
it.each(['create', 'update', 'get', 'list', 'delete'])('decodes role %s nested business output', async action => {
    const f = fixture({ code: 0, data: '{"role_id":"rol1"}' });
    const args = { 'base-token': 'b/a', 'role-id': 'r/a', json: { name: 'Reviewers' } };
    expect(await command(`role-${action}`).execute(args, f.context)).toEqual({ role_id: 'rol1' });
    const request = f.request.mock.calls[0]![0];
    expect(request.method).toBe(({ create: 'POST', update: 'PUT', get: 'GET', list: 'GET', delete: 'DELETE' })[action]);
    expect(request.path).toBe(`/open-apis/base/v3/bases/b%2Fa/roles${['create', 'list'].includes(action) ? '' : '/r%2Fa'}`);
    if (action === 'delete') expect(request.body).toEqual({});
});
it('rejects nested business failure and accepts empty success', async () => {
    const f = fixture({ code: 123, message: 'No access' });
    await expect(command('role-get').execute({ 'base-token': 'b', 'role-id': 'r' }, f.context)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', details: { upstreamCode: 123 } });
    expect(await command('role-list').execute({ 'base-token': 'b' }, fixture(null).context)).toEqual({ success: true });
});
it.each(['enable', 'disable'])('sets advanced permissions %s explicitly', async action => {
    const f = fixture({});
    await command(`advperm-${action}`).execute({ 'base-token': 'b' }, f.context);
    expect(f.request).toHaveBeenCalledWith({ method: 'PUT', path: '/open-apis/base/v3/bases/b/advperm/enable', query: { enable: action === 'enable' ? 'true' : 'false' } });
});
it.each(['get', 'enable', 'disable'])('preserves workflow %s request', async action => {
    const f = fixture({ workflow_id: 'wkf1' });
    const args = { 'base-token': 'b', 'workflow-id': 'wkf1', ...(action === 'get' ? { 'user-id-type': 'union_id' } : {}) };
    expect(await command(`workflow-${action}`).execute(args, f.context)).toEqual({ workflow_id: 'wkf1' });
    expect(f.request).toHaveBeenCalledWith({ method: action === 'get' ? 'GET' : 'PATCH', path: `/open-apis/base/v3/bases/b/workflows/wkf1${action === 'get' ? '' : `/${action}`}`, ...(action === 'get' ? { query: { user_id_type: 'union_id' } } : { body: {} }) });
});

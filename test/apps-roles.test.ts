import { expect, it, vi } from 'vitest';
import { appsCapabilities } from '../src/capabilities/apps/commands';
import { appsPrograms } from '../src/capabilities/apps/programs';
import { ServiceError } from '../src/domain/errors';
import type { CommandContext } from '../src/ports/capabilities';
function fixture(action: string, data: Record<string, unknown> = {}) {
    const request = vi.fn().mockResolvedValue(data);
    const capability = appsCapabilities().find((item) => item.definition.id === `apps.+role-${action}`)!;
    return { request, run: (args: Record<string, unknown> = {}) => capability.execute({ 'app-id': 'app_a', ...args }, { lark: { request } } as unknown as CommandContext) };
}
it('creates, updates and reads validated role objects', async () => {
    const data = { role: { role_id: 'r', name: 'Role' } };
    const create = fixture('create', data); expect(await create.run({ name: ' Role ', 'role-id': 'r', description: '' })).toEqual(data);
    expect(create.request.mock.calls[0]![0].body).toEqual({ name: 'Role', role_id: 'r', description: '' });
    const update = fixture('update', data); await update.run({ 'role-id': 'r', description: '' });
    expect(update.request.mock.calls[0]![0].body).toEqual({ description: '' });
    expect(await fixture('get', data).run({ 'role-id': 'r' })).toEqual(data);
});
it('normalizes empty delete acknowledgments but rejects mismatched targets', async () => {
    expect(await fixture('delete').run({ 'role-id': 'r', yes: true })).toEqual({ role_id: 'r', deleted: true });
    await expect(fixture('delete', { role_id: 'other', deleted: true }).run({ 'role-id': 'r', yes: true })).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
    await expect(fixture('delete').run({ 'role-id': 'r' })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
});
it.each([{ name: ' ' }, { name: 'R', 'role-id': 'a/b' }, { name: 'R', 'app-id': 'cli_app' }])('rejects invalid role create arguments %j', async (args) => {
    const f = fixture('create'); await expect(f.run(args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' }); expect(f.request).not.toHaveBeenCalled();
});
it('preserves role member atomic groups and clear-all exclusivity', async () => {
    const f = fixture('member-add', { users: ['ou_a'], accepted: true });
    expect(await f.run({ 'role-id': 'r', users: ' ou_a, ,ou_b ', chats: 'oc_c' })).toHaveProperty('accepted', true);
    expect(f.request.mock.calls[0]![0].body).toEqual({ users: ['ou_a', 'ou_b'], chats: ['oc_c'] });
    await expect(fixture('member-add').run({ 'role-id': 'r', users: Array(101).fill('ou_a').join(',') })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(fixture('member-remove').run({ 'role-id': 'r', users: 'ou_a', all: true, yes: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    const remove = fixture('member-remove'); await remove.run({ 'role-id': 'r', all: true, yes: true });
    expect(remove.request.mock.calls[0]![0].body).toEqual({ all: true });
});
it('fails closed for incomplete member baselines and filters only selected groups', async () => {
    expect(await fixture('member-list').run({ 'role-id': 'r', 'member-type': 'chat' })).toEqual({ chats: [] });
    await expect(fixture('member-list', { users: [] }).run({ 'role-id': 'r' })).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
    expect(await fixture('member-list', { users: ['ou_a'], chats: ['oc_a'], departments: [] }).run({ 'role-id': 'r', 'member-type': 'chat' })).toEqual({ chats: ['oc_a'] });
});
it('retries recognized unsupported chat filtering and no other errors', async () => {
    const f = fixture('member-list', { users: [], departments: [], chats: ['oc_c'] });
    f.request.mockRejectedValueOnce(new ServiceError('UPSTREAM_ERROR', 'Rejected', 502, { upstreamCode: 3344040 }));
    expect(await f.run({ 'role-id': 'r', 'member-type': 'chat' })).toEqual({ chats: ['oc_c'] });
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.request.mock.calls[1]![0]).not.toHaveProperty('query');
});
it('matches roles for a typed user ID', async () => {
    const f = fixture('match-list', { roles: [{ role_id: 'r', name: 'R' }] });
    expect(await f.run({ 'user-id': 'ou_a' })).toHaveProperty('roles');
    expect(f.request.mock.calls[0]![0]).toEqual({ method: 'POST', path: '/open-apis/spark/v1/apps/app_a/user_role_list', body: { target_user_id: 'ou_a' } });
});
it('normalizes single-page integer role pagination', async () => {
    const f = fixture('list', { items: [{ role_id: 'r', name: 'R' }], total: '42', has_more: true });
    expect(await f.run({ 'page-size': 20, 'page-token': '20' })).toEqual({ items: [{ role_id: 'r', name: 'R' }], total: 42, has_more: true, page_token: '40' });
    expect(f.request.mock.calls[0]![0].query).toEqual({ limit: 20, offset: 20 });
});
it('scans exact-name matches and verifies complete page progress', async () => {
    const program = appsPrograms().find((program) => program.id === 'apps-role-list')!;
    const request = vi.fn().mockResolvedValueOnce({ items: [{ role_id: 'a', name: 'other' }], total: 2, has_more: true }).mockResolvedValueOnce({ items: [{ role_id: 'b', name: 'wanted' }], total: 2, has_more: false });
    const context = { lark: { request } } as unknown as CommandContext;
    const first = await program.step({ args: { 'app-id': 'app_a', name: 'wanted' }, page: 0, seen: [], matches: [], scanned: 0 }, context);
    expect(first.done).toBe(false); if (first.done) throw new Error('Expected continuation.');
    expect(await program.step(first.state, context)).toEqual({ done: true, output: { items: [{ role_id: 'b', name: 'wanted' }], total: 1, has_more: false, page_token: '' } });
    request.mockResolvedValue({ items: [{ role_id: 'a', name: 'wanted' }], total: 2, has_more: false });
    await expect(program.step(first.state, context)).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
});
it('retains the upstream thousand-page role scan ceiling', async () => {
    const program = appsPrograms().find((program) => program.id === 'apps-role-list')!;
    const request = vi.fn().mockResolvedValue({ items: [], total: 0, has_more: false });
    const state = { args: { 'app-id': 'app_a', name: 'wanted' }, page: 100, scanned: 0 };
    expect(await program.step(state, { lark: { request } } as unknown as CommandContext)).toMatchObject({ done: true });
    await expect(program.step({ ...state, page: 1000 }, { lark: { request } } as unknown as CommandContext)).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
});

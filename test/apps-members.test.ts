import { expect, it, vi } from 'vitest';
import { appsCapabilities } from '../src/capabilities/apps/commands';
import type { CommandContext } from '../src/ports/capabilities';
function fixture(name: string, data: Record<string, unknown> = {}) {
    const request = vi.fn().mockResolvedValue(data);
    const capability = appsCapabilities().find((item) => item.definition.id === `apps.+member-${name}`)!;
    return { request, run: (args: Record<string, unknown> = {}) => capability.execute({ 'app-id': 'app_a', ...args }, { lark: { request } } as unknown as CommandContext) };
}
it.each([['openid', 'ou_user', 'user_open_id', 'user'], ['openchat', 'oc_chat', 'chat_id', 'chat'], ['opendepartmentid', 'od-dept', 'department_id', 'department']])('maps %s identities and never leaks metadata tokens', async (type, id, field, responseType) => {
    const f = fixture('add', { member: { member_type: responseType, [field!]: id, role: 'edit', meta_token: 'hidden' }, changed: true });
    expect(await f.run({ 'member-type': type, 'member-id': id, perm: 'edit', 'need-notification': false })).toEqual({ member: { member_type: responseType, member_id: id, role: 'edit' }, changed: true });
    expect(f.request.mock.calls[0]![0].body).toEqual({ [field!]: id, role: 'edit', need_notification: false });
});
it('projects lists and permission transitions', async () => {
    const member = { member_type: 'user', user_open_id: 'ou_u', role: 'edit' };
    expect(await fixture('list', { items: [member] }).run({ role: 'edit', 'member-type': 'user' })).toEqual({ items: [{ member_type: 'user', member_id: 'ou_u', role: 'edit' }] });
    expect(await fixture('update', { member, before_role: 'view', after_role: 'edit', changed: true }).run({ 'member-type': 'openid', 'member-id': 'ou_u', perm: 'edit' })).toMatchObject({ before_role: 'view', after_role: 'edit', changed: true });
});
it('removes using the remove endpoint and explicit confirmation', async () => {
    const f = fixture('remove', { member: { member_type: 'user', user_open_id: 'ou_u', role: 'view' }, changed: false });
    await f.run({ 'member-type': 'openid', 'member-id': 'ou_u', yes: true });
    expect(f.request.mock.calls[0]![0]).toEqual({ method: 'POST', path: '/open-apis/spark/v1/apps/app_a/members/remove', body: { user_open_id: 'ou_u' } });
});
it.each([{ 'app-id': 'cli_x' }, { 'member-id': '123' }, { 'member-id': 'ou_x/other' }, { perm: 'owner' }])('rejects invalid collaborator targets %j', async (args) => {
    const f = fixture('add');
    await expect(f.run({ 'member-type': 'openid', 'member-id': 'ou_u', perm: 'view', ...args })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(f.request).not.toHaveBeenCalled();
});
it.each([{ items: [{ member_type: 'user', user_open_id: 'ou_u', chat_id: 'oc_c', role: 'view' }] }, { items: [{ member_type: 'user', user_open_id: '123', role: 'view' }] }, {}])('fails closed on malformed collaborator responses', async (data) => {
    await expect(fixture('list', data).run()).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
});
it('projects settings and validates change fields', async () => {
    expect(await fixture('settings-get', { settings: { external_access: 'enabled', meta_token: 'hidden' } }).run()).toEqual({ settings: { external_access: 'enabled' } });
    const f = fixture('settings-set', { settings: { link_share: 'closed' }, changes: [{ field: 'link_share', before: 'tenant-readable', after: 'closed' }], changed: true });
    expect(await f.run({ 'link-share': 'closed' })).toHaveProperty('changed', true);
    expect(f.request.mock.calls[0]![0].body).toEqual({ link_share: 'closed' });
    await expect(fixture('settings-get', { settings: { external_access: 'unknown' } }).run()).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
    await expect(fixture('settings-set').run()).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});

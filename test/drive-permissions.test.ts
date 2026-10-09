import { describe, it, expect, vi } from 'vitest';
import { driveCapabilities } from '../src/capabilities/drive/commands';
import type { JsonObject } from '../src/domain/models';
import type { CommandContext } from '../src/ports/capabilities';
import type { ApiRequest } from '../src/ports/lark';
const setup = (responses: JsonObject[] = [], identity: 'user' | 'bot' = 'user') => ({ lark: { request: vi.fn(async (_: ApiRequest) => responses.shift() ?? {}) }, selection: { profileId: 'p', identity }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', accounts: ['ou_user'], identities: ['user', 'bot'] }], domains: ['drive'], permissions: ['read', 'write'] } } satisfies CommandContext);
const command = (action: string) => driveCapabilities().find((item) => item.definition.id === `drive.+${action}`)!;
describe('Drive permission shortcuts', () => {
    it('uses inferred URLs, explicit false notifications and Wiki permission defaults', async () => {
        const ctx = setup([{}]);
        expect(await command('member-add').execute({ token: 'https://example.test/wiki/target', 'member-id': 'ou_one', 'member-type': 'openid', 'need-notification': false }, ctx)).toMatchObject({ member_id: 'ou_one', member_kind: 'user', perm_type: 'container', perm: 'view' });
        expect(ctx.lark.request).toHaveBeenCalledExactlyOnceWith({ method: 'POST', path: '/open-apis/drive/v1/permissions/target/members', query: { type: 'wiki', need_notification: false }, body: { member_id: 'ou_one', member_type: 'openid', perm: 'view', type: 'user', perm_type: 'container' } });
    });
    it('matches batch results by ID and exposes omitted collaborators', async () => {
        const ctx = setup([{ members: [{ member_id: 'ou_two' }] }]);
        expect(await command('member-add').execute({ token: 'doc', type: 'docx', 'member-id': 'ou_one,ou_two', 'member-type': 'openid' }, ctx)).toMatchObject({ requested_count: 2, succeeded_count: 1, partial: true, missing_member_ids: ['ou_one'] });
        expect(ctx.lark.request.mock.calls[0]?.[0].path).toBe('/open-apis/drive/v1/permissions/doc/members/batch_create');
    });
    it('removes Wiki-space role through body and preserves the member type query', async () => {
        const ctx = setup();
        await command('member-remove').execute({ token: 'wiki', type: 'wiki', 'member-id': '123', 'member-type': 'wikispaceid', 'member-kind': 'wiki_space_viewer' }, ctx);
        expect(ctx.lark.request).toHaveBeenCalledExactlyOnceWith({ method: 'DELETE', path: '/open-apis/drive/v1/permissions/wiki/members/123', query: { type: 'wiki', member_type: 'wikispaceid' }, body: { type: 'wiki_space_viewer' } });
    });
    it.each([
        ['member-add', { token: 'd', type: 'docx', 'member-id': 'ou_one', 'member-type': 'email' }],
        ['member-add', { token: 'd', type: 'docx', 'member-id': 'ou_one,ou_one', 'member-type': 'openid' }],
        ['member-add', { token: 'd', type: 'docx', 'member-id': 'ou_one', 'member-type': 'openid', 'need-notification': false }],
        ['member-remove', { token: 'https://example.test/docx/a/b', 'member-id': 'ou_one', 'member-type': 'openid' }],
        ['member-list', { token: 'd', type: 'docx', fields: '*,name' }],
        ['secure-label-update', { token: 'd', type: 'docx', 'label-id': 'Public' }],
    ])('validates %s before preview or writes', async (action, args) => {
        const ctx = setup([], 'bot');
        await expect(command(action as string).preview(args as JsonObject, ctx)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(command(action as string).execute(args as JsonObject, ctx)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(ctx.lark.request).not.toHaveBeenCalled();
    });
    it('reads settings and normalized optional collaborator fields', async () => {
        const ctx = setup([{ permission_public: { external_access: false } }, { items: [] }]);
        expect(await command('permission-get-setting').execute({ token: 'https://example.test/drive/folder/folder' }, ctx)).toEqual({ permission_public: { external_access: false } });
        await command('member-list').execute({ token: 'wiki', type: 'wiki', fields: 'name,name, avatar', 'perm-type': 'single_page' }, ctx);
        expect(ctx.lark.request).toHaveBeenLastCalledWith({ method: 'GET', path: '/open-apis/drive/v1/permissions/wiki/members', query: { type: 'wiki', fields: 'name,avatar', perm_type: 'single_page' } });
    });
    it('creates folder and shortcut with exact output and reports a failed optional grant', async () => {
        const ctx = setup([{ token: 'new', url: 'https://example.test/drive/folder/new' }, {}], 'bot');
        expect(await command('create-folder').execute({ name: 'Reports' }, ctx)).toMatchObject({ created: true, folder_token: 'new', permission_grant: { status: 'granted' } });
        const shortcut = setup([{ succ_shortcut_node: { token: 'shortcut', name: 'Report' } }]);
        expect(await command('create-shortcut').execute({ 'file-token': 'doc', type: 'docx', 'folder-token': 'folder' }, shortcut)).toMatchObject({ shortcut_token: 'shortcut', source_file_token: 'doc', title: 'Report' });
        expect(shortcut.lark.request).toHaveBeenCalledExactlyOnceWith({ method: 'POST', path: '/open-apis/drive/v1/files/create_shortcut', body: { parent_token: 'folder', refer_entity: { refer_token: 'doc', refer_type: 'docx' } } });
    });
});

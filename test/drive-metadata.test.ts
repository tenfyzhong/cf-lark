import { describe, it, expect, vi } from 'vitest';
import { driveMetadataCapabilities } from '../src/capabilities/drive/metadata';
import type { ApiRequest } from '../src/ports/lark';
import type { JsonObject } from '../src/domain/models';
import type { CommandContext } from '../src/ports/capabilities';
const setup = (responses: JsonObject[] = []) => ({ lark: { brand: 'feishu', request: vi.fn(async (_: ApiRequest) => responses.shift() ?? {}) }, selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [], domains: ['drive'], permissions: ['read', 'write'] } } satisfies CommandContext);
const command = (action: string) => driveMetadataCapabilities().find((item) => item.definition.id === `drive.+${action}`)!;
describe('Drive metadata shortcuts', () => {
    it('requires a copied token and grants the bot creator access to the result', async () => {
        await expect(command('copy').execute({ token: 'source', type: 'file', name: 'copy', 'folder-token': 'folder' }, setup([{}]))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
        const ctx: CommandContext = setup([{ file: { token: 'copy', type: 'file' } }, {}]);
        ctx.selection.identity = 'bot'; ctx.grant.profiles = [{ profileId: 'p', identities: ['bot', 'user'], accounts: ['ou_user'] }];
        expect(await command('copy').execute({ token: 'source', type: 'file', name: 'copy', 'folder-token': 'folder' }, ctx)).toMatchObject({ permission_grant: { status: 'granted' } });
    });
    it('unwraps Wiki copy and resolves My Space before preserving extra key values', async () => {
        const ctx = setup([{ node: { obj_token: 'doc', obj_type: 'docx' } }, { token: 'root' }, { file: { token: 'copy', name: 'Copied', type: 'docx' } }]);
        expect(await command('copy').execute({ url: 'https://example.test/wiki/wiki', name: 'Copied', 'folder-token': 'my_space', extra: ['target_type=docx', 'other=a=b'] }, ctx)).toMatchObject({ copied: true, source_wiki_token: 'wiki', source_file_token: 'doc', file_token: 'copy' });
        expect(ctx.lark.request).toHaveBeenLastCalledWith({ method: 'POST', path: '/open-apis/drive/v1/files/doc/copy', body: { name: 'Copied', type: 'docx', folder_token: 'root', extra: [{ key: 'target_type', value: 'docx' }, { key: 'other', value: 'a=b' }] } });
    });
    it('preserves the file extension and reports previous title; allow skips metadata', async () => {
        const ctx = setup([{ metas: [{ title: 'old.md' }] }, {}]);
        expect(await command('update-title').execute({ token: 'file', type: 'file', title: 'new' }, ctx)).toMatchObject({ title: 'new.md', previous_title: 'old.md', extension_appended: '.md' });
        expect(ctx.lark.request).toHaveBeenLastCalledWith({ method: 'PATCH', path: '/open-apis/drive/v1/files/file', query: { type: 'file' }, body: { new_title: 'new.md' } });
        const allow = setup(); await command('update-title').execute({ token: 'file', type: 'file', title: 'new.txt', 'on-extension-mismatch': 'allow' }, allow);
        expect(allow.lark.request).toHaveBeenCalledTimes(1);
        await expect(command('update-title').execute({ token: 'file', type: 'file', title: 'new.txt' }, setup([{ metas: [{ title: 'old.md' }] }]))).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('keeps Wiki node identity for rename but returns underlying metadata for inspect', async () => {
        const rename = setup(); await command('update-title').execute({ url: 'https://example.test/wiki/wiki', title: 'Title' }, rename);
        expect(rename.lark.request).toHaveBeenCalledExactlyOnceWith({ method: 'PATCH', path: '/open-apis/drive/v1/files/wiki', query: { type: 'wiki' }, body: { new_title: 'Title' } });
        const inspect = setup([{ node: { obj_token: 'doc', obj_type: 'docx', node_token: 'wiki', space_id: '123' } }, { metas: [{ title: 'Title' }] }]);
        expect(await command('inspect').execute({ url: 'https://example.test/wiki/wiki' }, inspect)).toMatchObject({ token: 'doc', type: 'docx', title: 'Title', wiki_node: { node_token: 'wiki' } });
    });
    it('transforms history but takes the cursor from the final raw item', async () => {
        const ctx = setup([{ items: [{ version: '9223372036854775807', name: 'notes.md', edit_time: 100, type: 4, size: 5, tag: 2 }, { edit_time: '90' }], has_more: true }]);
        expect(await command('version-history').execute({ 'file-token': 'file', limit: 2, cursor: '101' }, ctx)).toMatchObject({ versions: [{ version: '9223372036854775807', action_type: 'revert', edited_at: '100' }], next_cursor: '90', has_more: true });
        expect(ctx.lark.request).toHaveBeenCalledExactlyOnceWith({ method: 'GET', path: '/open-apis/drive/v1/files/file/history', query: { only_tag: true, page_size: 2, last_edit_time: '101' } });
        await command('version-revert').execute({ 'file-token': 'file', version: '9223372036854775807' }, ctx);
        await command('version-delete').execute({ 'file-token': 'file', version: '123' }, ctx);
        expect(ctx.lark.request.mock.calls.slice(1).map(([req]) => req.path)).toEqual(['/open-apis/drive/v1/files/file/revert', '/open-apis/drive/v1/files/file/version_del']);
    });
});

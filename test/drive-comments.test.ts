import { describe, it, expect, vi } from 'vitest';
import { driveCommentCapabilities } from '../src/capabilities/drive/comments';
import type { ApiRequest } from '../src/ports/lark';
import type { JsonObject } from '../src/domain/models';
import type { CommandContext } from '../src/ports/capabilities';
const setup = (responses: JsonObject[] = []) => ({ lark: { request: vi.fn(async (_: ApiRequest) => responses.shift() ?? {}) }, selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [], domains: ['drive'], permissions: ['read', 'write'] } } satisfies CommandContext);
const command = (action: string) => driveCommentCapabilities().find((item) => item.definition.id === `drive.+${action}`)!;
const content = JSON.stringify([{ type: 'text', text: '<Review>' }, { type: 'mention_user', text: 'ou_user' }]);
describe('Drive comment shortcuts', () => {
    it('preserves type-specific output anchors and normalizes Wiki Base aliases', async () => {
        expect(await command('add-comment').execute({ doc: 'doc', type: 'docx', 'block-id': 'block', content }, setup([{ comment_id: 'c' }]))).toMatchObject({ anchor_block_id: 'block', selection_source: 'block_id' });
        expect(await command('add-comment').execute({ doc: 'sheet', type: 'sheet', 'block-id': 'sheet!B2', content }, setup([{ comment_id: 'c' }]))).toMatchObject({ block_id: 'sheet!B2' });
        expect(await command('add-comment').execute({ doc: 'https://example.test/wiki/wiki', 'block-id': 'table!record!view', content }, setup([{ node: { obj_type: 'base', obj_token: 'base' } }, { comment_id: 'c' }]))).toMatchObject({ base_block_id: 'table', base_record_id: 'record', base_view_id: 'view' });
    });
    it('unwraps Wiki before transforming reply elements and returns nested reply IDs', async () => {
        const ctx = setup([{ node: { obj_token: 'doc', obj_type: 'docx' } }, { reply_list: { replies: [{ reply_id: 'reply' }] } }]);
        expect(await command('add-reply').execute({ url: 'https://example.test/wiki/wiki', 'comment-id': 'comment', content }, ctx)).toMatchObject({ file_token: 'doc', file_type: 'docx', wiki_token: 'wiki', reply_id: 'reply', created: true });
        expect(ctx.lark.request).toHaveBeenLastCalledWith({ method: 'POST', path: '/open-apis/drive/v1/files/doc/comments/comment/replies', query: { file_type: 'docx' }, body: { content: { elements: [{ type: 'text_run', text_run: { text: '&lt;Review&gt;' } }, { type: 'person', person: { user_id: 'ou_user' } }] } } });
    });
    it.each([
        ['sheet', 'sheet!AA12', { block_id: 'sheet', sheet_col: 26, sheet_row: 11 }],
        ['slides', 'shape!xml', { block_id: 'xml', slide_block_type: 'shape' }],
        ['bitable', 'table!record!view', { block_id: 'table', base_record_id: 'record', base_view_id: 'view' }],
        ['docx', 'block', { block_id: 'block' }],
    ])('creates anchored %s comments', async (type, block, anchor) => {
        const ctx = setup([{ comment_id: 'comment' }]);
        await command('add-comment').execute({ doc: 'doc', type, 'block-id': block, content }, ctx);
        expect(ctx.lark.request).toHaveBeenCalledExactlyOnceWith({ method: 'POST', path: '/open-apis/drive/v1/files/doc/new_comments', body: { file_type: type, reply_elements: [{ type: 'text', text: '&lt;Review&gt;' }, { type: 'mention_user', mention_user: 'ou_user' }], anchor } });
    });
    it('checks file metadata before file comments and rejects unsupported extensions', async () => {
        const ctx = setup([{ metas: [{ title: 'notes.md' }] }, { comment_id: 'comment' }]);
        expect(await command('add-comment').execute({ doc: 'file', type: 'file', content }, ctx)).toMatchObject({ file_name: 'notes.md', file_extension: '.md' });
        expect(ctx.lark.request.mock.calls[1]?.[0].body).toMatchObject({ anchor: { block_id: 'test' } });
        const invalid = setup([{ metas: [{ title: 'unknown.exe' }] }]);
        await expect(command('add-comment').execute({ doc: 'file', type: 'file', content }, invalid)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(invalid.lark.request).toHaveBeenCalledTimes(1);
    });
    it('uses typed filters and omits docx-only relation flags for other types', async () => {
        const ctx = setup([{ items: null, has_more: true, page_token: 'next' }]);
        expect(await command('list-comments').execute({ token: 'sheet', type: 'sheet', 'solved-status': 'all', 'comment-scope': 'partial', 'need-reaction': true, 'need-relation': true }, ctx)).toMatchObject({ items: [], count: 0, page_token: 'next' });
        expect(ctx.lark.request).toHaveBeenCalledExactlyOnceWith({ method: 'GET', path: '/open-apis/drive/v1/files/sheet/comments', query: { file_type: 'sheet', page_size: 50, is_whole: false, need_reaction: true } });
    });
    it('maps batch, resolved/restored, reply updates/deletes and reaction requests', async () => {
        const ctx = setup([{ items: [] }, {}, {}, {}, {}, {}]);
        const common = { token: 'doc', type: 'docx', 'comment-id': 'comment', 'reply-id': 'reply' };
        await command('batch-query-comments').execute({ token: 'doc', type: 'docx', 'comment-ids': ['a', 'b'], 'need-relation': true }, ctx);
        await command('resolve-comment').execute(common, ctx);
        await command('restore-comment').execute(common, ctx);
        await command('update-reply').execute({ ...common, content }, ctx);
        await command('delete-reply').execute(common, ctx);
        await command('react-reply').execute({ ...common, action: 'delete', emoji: 'THUMBSUP' }, ctx);
        expect(ctx.lark.request.mock.calls.map(([req]) => req.method)).toEqual(['POST', 'PATCH', 'PATCH', 'PUT', 'DELETE', 'POST']);
        expect(ctx.lark.request.mock.calls[1]?.[0].body).toEqual({ is_solved: true });
        expect(ctx.lark.request.mock.calls[2]?.[0].body).toEqual({ is_solved: false });
        expect(ctx.lark.request.mock.calls[5]?.[0]).toMatchObject({ path: '/open-apis/drive/v2/files/doc/comments/reaction', body: { action: 'delete', reaction_type: 'THUMBSUP', reply_id: 'reply' } });
    });
    it('rejects aggregate text overflow, conflicting source inputs and invalid anchors before I/O', async () => {
        const ctx = setup();
        for (const args of [
            { doc: 'doc', type: 'docx', content: JSON.stringify([{ type: 'text', text: 'a'.repeat(5001) }, { type: 'text', text: 'b'.repeat(5000) }]) },
            { doc: 'doc', type: 'sheet', 'block-id': 'sheet!A0', content },
            { doc: 'doc', type: 'docx', 'block-id': 'block', 'full-comment': true, content },
        ]) await expect(command('add-comment').preview(args, ctx)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(ctx.lark.request).not.toHaveBeenCalled();
    });
});

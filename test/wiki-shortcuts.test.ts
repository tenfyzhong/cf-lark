import { describe, expect, it, vi } from 'vitest';
import { wikiCapabilities, wikiPrograms } from '../src/capabilities/wiki/commands';
import type { CommandContext } from '../src/ports/capabilities';
import type { ApiRequest } from '../src/ports/lark';
import type { JsonObject } from '../src/domain/models';
const context = (responses: JsonObject[], identity: 'user' | 'bot' = 'user') => ({
    lark: { request: vi.fn(async (_request: ApiRequest) => responses.shift() ?? {}) },
    selection: { profileId: 'profile', identity },
    grant: { id: 'grant', expiresAt: Date.now() + 60000, revoked: false, profiles: [], domains: ['wiki'], permissions: ['read', 'write'] },
} satisfies CommandContext);
async function run(action: string, args: JsonObject, ctx: CommandContext) {
    const program = wikiPrograms().find((item) => item.id === `wiki-${action}`)!;
    let state: JsonObject = { args, phase: 'start' };
    for (let index = 0; index < 100; index++) {
        const before = vi.mocked(ctx.lark.request).mock.calls.length;
        const step = await program.step(state, ctx);
        expect(vi.mocked(ctx.lark.request).mock.calls.length - before).toBeLessThanOrEqual(1);
        if (step.done) return step.output;
        state = step.state;
    }
    throw new Error('Workflow did not complete');
}
describe('Wiki shortcuts', () => {
    it('adds canonical Wiki URLs to creation and copies', async () => {
        expect(await run('node-copy', { 'space-id': '123', 'node-token': 'source', 'target-space-id': '456' }, context([{ node: { node_token: 'copy' } }]))).toMatchObject({ url: 'https://feishu.cn/wiki/copy' });
    });
    it('projects node details and rejects malformed move task statuses', async () => {
        const output = await run('node-get', { 'node-token': 'node' }, context([{ node: { node_token: 'node', obj_token: 'doc', obj_type: 'docx', node_creator: 'ou_creator', creator: 'ignored', obj_edit_time: '1700000000', url: 'https://upstream.test' } }])) as JsonObject;
        expect(output).toMatchObject({ creator: 'ou_creator', updated_at: '2023-11-14T22:13:20Z' }); expect(output).not.toHaveProperty('url');
        await expect(run('move-to-drive', { 'node-token': 'node' }, context([{ task_id: 'task' }, { task: { move_wiki_to_docs_result: {} } }]))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });
    it('rejects decoded unsafe tokens before requests', async () => {
        const ctx = context([]); await expect(run('node-get', { 'node-token': 'https://example.test/wiki/%2Fescape' }, ctx)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' }); expect(ctx.lark.request).not.toHaveBeenCalled();
    });
    it('resolves personal library and removes the exact member tuple with a DELETE body', async () => {
        const ctx = context([{ space: { space_id: '123' } }, {}]);
        expect(await run('member-remove', { 'space-id': 'my_library', 'member-id': 'a@example.test', 'member-type': 'email', 'member-role': 'admin' }, ctx)).toMatchObject({ space_id: '123', member_id: 'a@example.test', member_type: 'email', member_role: 'admin' });
        expect(ctx.lark.request).toHaveBeenLastCalledWith({ method: 'DELETE', path: '/open-apis/wiki/v2/spaces/123/members/a%40example.test', body: { member_type: 'email', member_role: 'admin' } });
    });
    it('preserves explicit false notification and defensive member echo defaults', async () => {
        const ctx = context([{ member: { member_id: '', member_type: 'email' } }]);
        expect(await run('member-add', { 'space-id': '123', 'member-id': 'a@example.test', 'member-type': 'email', 'member-role': 'member', 'need-notification': false }, ctx)).toMatchObject({ member_id: 'a@example.test', member_role: 'member' });
        expect(ctx.lark.request).toHaveBeenCalledWith({ method: 'POST', path: '/open-apis/wiki/v2/spaces/123/members', query: { need_notification: false }, body: { member_id: 'a@example.test', member_type: 'email', member_role: 'member' } });
    });
    it('pages with one call per checkpoint, preserves empty pages and page limits', async () => {
        const ctx = context([{ items: [], has_more: true, page_token: 'next' }, { items: [{ name: 'Space', space_id: '2' }], has_more: true, page_token: 'last' }]);
        expect(await run('space-list', { 'page-all': true, 'page-limit': 2 }, ctx)).toMatchObject({ spaces: [{ name: 'Space', space_id: '2' }], has_more: true, page_token: 'last' });
        expect(ctx.lark.request).toHaveBeenCalledTimes(2);
    });
    it('explicit cursor overrides page-all and normalizes parent Wiki URLs', async () => {
        const ctx = context([{ items: [], has_more: true, page_token: 'next' }]);
        await run('node-list', { 'space-id': '123', 'parent-node-token': 'https://example.test/wiki/parent', 'page-token': 'first', 'page-all': true }, ctx);
        expect(ctx.lark.request).toHaveBeenCalledExactlyOnceWith({ method: 'GET', path: '/open-apis/wiki/v2/spaces/123/nodes', query: { page_size: 50, page_token: 'first', parent_node_token: 'parent' } });
    });
    it.each([
        ['member-add', { 'space-id': 'my_library', 'member-id': 'u', 'member-type': 'openid', 'member-role': 'member' }],
        ['member-add', { 'space-id': '123', 'member-id': 'u', 'member-type': 'opendepartmentid', 'member-role': 'member' }],
        ['node-list', { 'space-id': 'notnumeric' }],
        ['space-list', { 'page-size': 51 }],
    ])('rejects invalid %s before I/O in execute and preview', async (action, args) => {
        const ctx = context([], 'bot');
        await expect(run(action as string, args as JsonObject, ctx)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        const capability = wikiCapabilities({ start: vi.fn(), resume: vi.fn() }).find((item) => item.definition.id === `wiki.+${action}`)!;
        await expect(capability.preview(args as JsonObject, ctx)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(ctx.lark.request).not.toHaveBeenCalled();
    });
});

describe('Wiki node workflows', () => {
    it('normalizes node URLs and asserts the returned space', async () => {
        const ctx = context([{ node: { node_token: 'wiki', obj_token: 'doc', space_id: '123', obj_type: 'docx', title: 'Title' } }]);
        expect(await run('node-get', { 'node-token': 'https://example.test/docx/doc', 'space-id': '123' }, ctx)).toMatchObject({ node_token: 'wiki', obj_token: 'doc', title: 'Title' });
        expect(ctx.lark.request).toHaveBeenCalledExactlyOnceWith({ method: 'GET', path: '/open-apis/wiki/v2/spaces/node_by_token', query: { token: 'doc' } });
    });
    it('infers creation space and canonical parent from a document token', async () => {
        const ctx = context([{ node: { node_token: 'parent', space_id: '123' } }, { node: { node_token: 'created', space_id: '123', obj_type: 'docx' } }]);
        expect(await run('node-create', { 'parent-node-token': 'document', title: 'Title' }, ctx)).toMatchObject({ node_token: 'created', resolved_by: 'parent_node_token', resolved_space_id: '123' });
        expect(ctx.lark.request).toHaveBeenLastCalledWith({ method: 'POST', path: '/open-apis/wiki/v2/spaces/123/nodes', body: { obj_type: 'docx', node_type: 'origin', parent_node_token: 'parent', title: 'Title' } });
    });
    it('canonicalizes both ends before moving and rejects mismatched destination before writes', async () => {
        const responses = [{ node: { node_token: 'source', space_id: '123' } }, { node: { node_token: 'parent', space_id: '456' } }, { node: { node_token: 'source', space_id: '456' } }];
        const ctx = context(structuredClone(responses));
        expect(await run('move', { 'node-token': 'sourceDoc', 'target-parent-token': 'parentDoc' }, ctx)).toMatchObject({ source_space_id: '123', target_space_id: '456', node_token: 'source' });
        expect(ctx.lark.request).toHaveBeenLastCalledWith({ method: 'POST', path: '/open-apis/wiki/v2/spaces/123/nodes/source/move', body: { target_parent_token: 'parent' } });
        const mismatch = context(structuredClone(responses));
        await expect(run('move', { 'node-token': 'sourceDoc', 'target-parent-token': 'parentDoc', 'target-space-id': '789' }, mismatch)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(mismatch.lark.request).toHaveBeenCalledTimes(2);
    });
    it('polls a deletion without replaying the write and uses the resolved document token', async () => {
        const ctx = context([{ node: { node_token: 'wiki', obj_token: 'doc', obj_type: 'docx', space_id: '123', node_type: 'origin' } }, { task_id: 'task' }, { task: { simple_task_result: { status: 'processing' } } }, { task: { simple_task_result: { status: 'success' } } }]);
        expect(await run('node-delete', { 'node-token': 'https://example.test/docx/doc', 'include-children': false }, ctx)).toMatchObject({ ready: true, node_token: 'doc', task_id: 'task' });
        expect(ctx.lark.request.mock.calls.filter(([req]) => req.method === 'DELETE')).toEqual([[{ method: 'DELETE', path: '/open-apis/wiki/v2/spaces/123/nodes/doc', body: { obj_type: 'docx', include_children: false } }]]);
    });
    it('never converts a shortcut into deletion of its origin document', async () => {
        const ctx = context([{ node: { node_token: 'shortcut', obj_token: 'origin', obj_type: 'docx', space_id: '123', node_type: 'shortcut' } }]);
        await expect(run('node-delete', { 'node-token': 'shortcut', 'obj-type': 'docx' }, ctx)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(ctx.lark.request).toHaveBeenCalledTimes(1);
    });
    it('supports copy, synchronous space deletion, approval submission and move-to-drive polling', async () => {
        expect(await run('node-copy', { 'space-id': '123', 'node-token': 'source', 'target-space-id': '456' }, context([{ node: { node_token: 'copy' } }]))).toMatchObject({ node_token: 'copy' });
        expect(await run('delete-space', { 'space-id': '123' }, context([{}]))).toMatchObject({ ready: true, status: 'success' });
        expect(await run('move', { 'obj-type': 'docx', 'obj-token': 'doc', 'target-space-id': '123', apply: true }, context([{ applied: true }]))).toMatchObject({ applied: true, ready: false });
        expect(await run('move-to-drive', { 'node-token': 'wiki', 'folder-token': 'folder' }, context([{ task_id: 'task' }, { task: { move_wiki_to_docs_result: { status: 0, obj_token: 'doc', obj_type: 'docx' } } }]))).toMatchObject({ ready: true, obj_token: 'doc' });
    });
});

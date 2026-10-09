import { describe, it, expect, vi } from 'vitest';
import { driveMutationPrograms, driveTaskResultCapability } from '../src/capabilities/drive/tasks';
import type { JsonObject } from '../src/domain/models';
import type { ApiRequest } from '../src/ports/lark';
import type { CommandContext } from '../src/ports/capabilities';
const setup = (responses: JsonObject[]) => ({ lark: { request: vi.fn(async (_: ApiRequest) => responses.shift() ?? {}) }, selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [], domains: ['drive'], permissions: ['read', 'write'] } } satisfies CommandContext);
async function run(action: string, args: JsonObject, context: CommandContext) { let state: JsonObject = { args }; const program = driveMutationPrograms().find((item) => item.id === `drive-${action}`)!; for (let i = 0; i < 40; i++) { const result = await program.step(state, context); if (result.done) return result.output; state = result.state; } throw new Error('Incomplete workflow'); }
describe('Drive mutation and task status shortcuts', () => {
    it('does not grant permissions while polling with a read-only authorization', async () => {
        const ctx = setup([{ result: { job_status: 0, token: 'file', type: 'file' } }]);
        ctx.selection.identity = 'bot' as 'user';
        ctx.grant.permissions = ['read'];
        expect(await driveTaskResultCapability().execute({ scenario: 'import', ticket: 'ticket' }, ctx)).toMatchObject({ ready: true, permission_grant: { skipped: true, reason: 'Drive write permission is required.' } });
        expect(ctx.lark.request).toHaveBeenCalledTimes(1);
    });
    it('resolves root folder then polls without repeating the folder move', async () => {
        const ctx = setup([{ token: 'root' }, { task_id: 'task' }, { result: { status: 'pending' } }, { status: 'success' }]);
        expect(await run('move', { 'file-token': 'folder', type: 'folder' }, ctx)).toMatchObject({ ready: true, folder_token: 'root', task_id: 'task' });
        expect(ctx.lark.request.mock.calls.filter(([req]) => req.method === 'POST')).toEqual([[{ method: 'POST', path: '/open-apis/drive/v1/files/folder/move', body: { type: 'folder', folder_token: 'root' } }]]);
    });
    it('handles synchronous deletes and rejects failed asynchronous outcomes', async () => {
        expect(await run('delete', { 'file-token': 'file', type: 'file' }, setup([{}]))).toEqual({ deleted: true, file_token: 'file', type: 'file' });
        await expect(run('delete', { 'file-token': 'file', type: 'file' }, setup([{ task_id: 'task' }, { status: 'fail' }]))).rejects.toMatchObject({ code: 'UPSTREAM_TASK_FAILED' });
    });
    it.each([
        ['import', { ticket: 'ticket' }, { result: { job_status: 0 } }, { ready: false, job_status_label: 'pending' }],
        ['export', { ticket: 'ticket', 'file-token': 'doc' }, { result: { job_status: 0, file_token: 'exported' } }, { ready: true, file_token: 'exported' }],
        ['task_check', { 'task-id': 'task' }, { result: { status: 'failed' } }, { ready: false, failed: true }],
        ['wiki_move', { 'task-id': 'task' }, { task: { move_result: [{ status: 0, node: { node_token: 'wiki' } }] } }, { ready: true, wiki_token: 'wiki' }],
        ['wiki_move_to_drive', { 'task-id': 'task' }, { task: { move_wiki_to_docs_result: { status: 0, obj_token: 'doc' } } }, { ready: true, obj_token: 'doc' }],
        ['wiki_delete_space', { 'task-id': 'task' }, { task: { delete_space_result: { status: 'SUCCESS' } } }, { ready: true }],
        ['wiki_delete_node', { 'task-id': 'task' }, { task: { simple_task_result: { status: 'failure' } } }, { failed: true }],
    ])('normalizes %s task results', async (scenario, args, response, expected) => {
        expect(await driveTaskResultCapability().execute({ scenario, ...args }, setup([response]))).toMatchObject(expected);
    });
});

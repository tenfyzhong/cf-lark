import { describe, expect, it, vi } from 'vitest';
import { taskCapabilities, taskPrograms } from '../src/capabilities/task/commands';
import type { CommandContext } from '../src/ports/capabilities';
type JsonObject = Record<string, any>;
import { ServiceError } from '../src/domain/errors';
const context = { selection: { identity: 'user', profileId: 'p', accountId: 'a' }, grant: { id: 'g' } } as CommandContext;
async function run(action: string, args: JsonObject, responses: (JsonObject | Error)[]) {
    const request = vi.fn(); responses.forEach(value => value instanceof Error ? request.mockRejectedValueOnce(value) : request.mockResolvedValueOnce(value));
    let state: JsonObject = { action, args, phase: 'start' };
    const program = taskPrograms().find(item => item.id === 'task-write')!;
    for (let index = 0; index < 100; index++) {
        const before = request.mock.calls.length;
        const result = await program.step(state, { ...context, lark: { request } });
        expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
        if (result.done) return { output: result.output as JsonObject, request };
        state = result.state;
    }
    throw new Error('Workflow did not finish');
}
describe('Task write workflows', () => {
    it('creates with explicit flags overriding JSON, app members, all-day due and tasklist applinks', async () => {
        const { output, request } = await run('create', { summary: 'Explicit', data: '{"summary":"Old","mode":2}', assignee: 'cli_bot', follower: 'ou_user', due: '2026-10-10', 'tasklist-id': 'https://example.test/tasklist?guid=list', 'idempotency-key': 'dedupe' }, [{ task: { guid: 'new', summary: 'Explicit', status: 'todo' } }]);
        expect(request.mock.calls[0]![0].body).toEqual({ summary: 'Explicit', mode: 2, members: [{ id: 'cli_bot', type: 'app', role: 'assignee' }, { id: 'ou_user', type: 'user', role: 'follower' }], due: { timestamp: String(Date.parse('2026-10-10')), is_all_day: true }, tasklists: [{ tasklist_guid: 'list' }], client_token: 'dedupe' });
        expect(output).toMatchObject({ guid: 'new', summary: 'Explicit', status: 'todo' });
    });
    it('updates multiple IDs with confirmed fields and supports clearing through JSON', async () => {
        const { output, request } = await run('update', { 'task-id': 'https://example.test/task?guid=one,two', data: '{"description":""}', summary: 'Title' }, [{ task: { guid: 'one', summary: 'Title', description: '' } }, { task: { guid: 'two', summary: 'Title' } }]);
        expect(request.mock.calls.map(call => call[0].path)).toEqual(['/open-apis/task/v2/tasks/one', '/open-apis/task/v2/tasks/two']);
        expect(output.tasks).toHaveLength(2);
        expect(output.tasks[0].confirmed).toEqual({ description: '', summary: 'Title' });
    });
    it('does not patch a completed task', async () => {
        const { output, request } = await run('complete', { 'task-id': 'guid' }, [{ task: { guid: 'guid', completed_at: '123' } }]);
        expect(request).toHaveBeenCalledTimes(1); expect(output.already_completed).toBe(true);
    });
    it('adds and removes assignees in order with idempotency only on add', async () => {
        const { request } = await run('assign', { 'task-id': 'guid', add: 'ou_a,cli_b', remove: 'ou_c', 'idempotency-key': 'key' }, [{ task: {} }, { task: {} }]);
        expect(request.mock.calls[0]![0].body.client_token).toBe('key');
        expect(request.mock.calls[1]![0].body).toEqual({ members: [{ id: 'ou_c', role: 'assignee', type: 'user' }] });
    });
    it('replaces reminders only after reading and removing old IDs', async () => {
        const { request } = await run('reminder', { 'task-id': 'guid', set: '2h' }, [{ task: { guid: 'guid', reminders: [{ id: 'old' }] } }, {}, {}]);
        expect(request.mock.calls.map(call => call[0].path)).toEqual(['/open-apis/task/v2/tasks/guid', '/open-apis/task/v2/tasks/guid/remove_reminders', '/open-apis/task/v2/tasks/guid/add_reminders']);
        expect(request.mock.calls[2]![0].body).toEqual({ reminders: [{ relative_fire_minute: 120 }] });
    });
    it('sets tasklist membership by exact difference', async () => {
        const { request } = await run('tasklist-members', { 'tasklist-id': 'list', set: 'ou_keep,ou_new' }, [{ tasklist: { members: [{ id: 'ou_keep' }, { id: 'ou_old' }] } }, { tasklist: {} }, { tasklist: {} }]);
        expect(request.mock.calls[1]![0].body.members).toEqual([{ id: 'ou_new', role: 'editor', type: 'user' }]);
        expect(request.mock.calls[2]![0].body.members).toEqual([{ id: 'ou_old', role: 'editor', type: 'user' }]);
    });
    it('preserves tasklist partial creation success and reports failed task indices', async () => {
        const { output, request } = await run('tasklist-create', { name: 'List', member: 'ou_editor', data: '[{"summary":"First","assignee":"ou_a"},{"summary":"Second"}]' }, [{ tasklist: { guid: 'list' } }, { task: { guid: 'first' } }, new ServiceError('UPSTREAM_ERROR', 'Denied')]);
        expect(request.mock.calls[1]![0].body).toEqual({ summary: 'First', members: [{ id: 'ou_a', type: 'user', role: 'assignee' }], tasklists: [{ tasklist_guid: 'list' }] });
        expect(output.ok).toBe(false); expect(output.created_tasks[0].guid).toBe('first'); expect(output.failed_tasks[0].index).toBe(1);
    });
    it.each([
        ['create', { data: '[]' }], ['update', { 'task-id': 't123', summary: 'Invalid ID' }], ['update', { 'task-id': 'valid' }],
        ['tasklist-create', { name: 'List', data: '[null]' }], ['reminder', { 'task-id': 'guid', set: 'x' }],
        ['tasklist-members', { 'tasklist-id': 'list', set: 'a', add: 'b' }],
    ])('rejects invalid %s inputs before remote mutation', async (action, args) => {
        const capability = taskCapabilities({ start: vi.fn() } as never).find(item => item.definition.id === `task.+${action}`)!;
        await expect(capability.preview(args as JsonObject)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it.each([
        { action: 'reopen', args: { 'task-id': 'guid' }, suffix: '/tasks/guid', body: { task: { completed_at: '0' }, update_fields: ['completed_at'] } },
        { action: 'comment', args: { 'task-id': 'guid', content: 'Update' }, suffix: '/comments', body: { content: 'Update', resource_id: 'guid', resource_type: 'task' } },
        { action: 'set-ancestor', args: { 'task-id': 'guid' }, suffix: '/tasks/guid/set_ancestor_task', body: {} },
        { action: 'followers', args: { 'task-id': 'guid', add: 'ou_a' }, suffix: '/tasks/guid/add_members', body: { members: [{ id: 'ou_a', type: 'user', role: 'follower' }] } },
    ])('constructs $action with the pinned endpoint and fields', async ({ action, args, suffix, body }) => {
        const { request } = await run(action, args, [{ task: { guid: 'guid' }, comment: { id: 'comment' } }]);
        expect(request.mock.calls[0]![0]).toMatchObject({ path: `/open-apis/task/v2${suffix}`, body });
    });
    it('adds multiple tasks to an applink tasklist and preserves per-item failure', async () => {
        const { output, request } = await run('tasklist-task-add', { 'tasklist-id': 'https://example.test/tasklist?guid=list', 'task-id': 'one,two', 'section-guid': 'section' }, [{ task: { guid: 'one' } }, new ServiceError('UPSTREAM_ERROR', 'Denied')]);
        expect(request.mock.calls[0]![0].body).toEqual({ tasklist_guid: 'list', section_guid: 'section' });
        expect(output).toMatchObject({ ok: false, tasklist_guid: 'list', successful_tasks: [{ guid: 'one' }], failed_tasks: [{ guid: 'two' }] });
    });
    it('never turns an uncertain fanout write into a retryable failure', async () => {
        await expect(run('tasklist-task-add', { 'tasklist-id': 'list', 'task-id': 'one,two' }, [new ServiceError('OUTCOME_UNCERTAIN', 'Unknown outcome')])).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
    });

});

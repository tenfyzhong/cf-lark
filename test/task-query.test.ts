import { describe, expect, it, vi } from 'vitest';
import { taskCapabilities, taskPrograms } from '../src/capabilities/task/commands';
import type { CommandContext } from '../src/ports/capabilities';
type JsonObject = Record<string, any>;

const context = { lark: { request: vi.fn() }, selection: { identity: 'user', profileId: 'p', accountId: 'a' }, grant: { id: 'g', profiles: ['p'], accounts: ['a'], identities: ['user'], domains: ['task'], permissions: ['read', 'write'], expiresAt: Date.now() + 100000 } } as unknown as CommandContext;
async function run(action: string, args: JsonObject, responses: JsonObject[]) {
    const request = vi.fn(); responses.forEach(value => request.mockResolvedValueOnce(value));
    let state: JsonObject = { action, args, phase: 'start' };
    const program = taskPrograms().find(item => item.id === 'task-query')!;
    for (let index = 0; index < 100; index++) {
        const before = request.mock.calls.length;
        const result = await program.step(state, { ...context, lark: { request } });
        expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
        if (result.done) return { output: result.output, request };
        state = result.state;
    }
    throw new Error('Workflow did not finish');
}
describe('Task query shortcut workflows', () => {
    it('paginates my tasks with explicit false, filters inclusive dates, and prefers exact summaries', async () => {
        const due = String(Date.parse('2026-10-01T00:00:00Z'));
        const { output, request } = await run('get-my-tasks', { complete: false, query: 'Report', 'due-start': '2026-10-01', 'due-end': '2026-10-31' }, [
            { items: [{ guid: 'partial', summary: 'Report draft', due: { timestamp: due } }], has_more: true, page_token: 'next' },
            { items: [{ guid: 'exact', summary: 'Report', due: { timestamp: due }, completed_at: '0', url: 'https://example.test/task?guid=exact&extra=1' }, { guid: 'no-due', summary: 'Report' }], has_more: false },
        ]);
        expect(request.mock.calls[0]![0]).toMatchObject({ method: 'GET', path: '/open-apis/task/v2/tasks', query: { type: 'my_tasks', completed: 'false', user_id_type: 'open_id', page_size: 50 } });
        expect(request.mock.calls[1]![0].query.page_token).toBe('next');
        expect(output).toMatchObject({ items: [{ guid: 'exact', summary: 'Report', completed: false, due_at: '2026-10-01T00:00:00Z', url: 'https://example.test/task?guid=exact' }], has_more: false });
        expect((output as JsonObject).items).toHaveLength(1);
    });
    it('enriches search hits one request at a time and retains failed detail identifiers', async () => {
        const { output, request } = await run('search', { completed: false, due: '2026-10-01,2026-10-31', 'page-limit': 1 }, [
            { items: [{ id: 't1' }, { id: 't2', meta_data: { app_link: 'https://example.test/?guid=t2&noise=1' } }], has_more: true, page_token: 'next', notice: 'Partial' },
            { task: { guid: 't1', summary: 'Task', members: [], completed_at: '0' } }, {},
        ]);
        expect(request.mock.calls[0]![0].body).toEqual({ query: '', filter: { is_completed: false, due_time: { start_time: '2026-10-01T00:00:00Z', end_time: '2026-10-31T23:59:59Z' } } });
        expect(output).toMatchObject({ items: [{ guid: 't1', summary: 'Task' }, { guid: 't2', url: 'https://example.test/?guid=t2' }], has_more: true, page_token: 'next', notice: 'Partial' });
    });
    it('validates preview and execution filters before starting a workflow', async () => {
        const start = vi.fn();
        const capability = taskCapabilities({ start } as never).find(item => item.definition.id === 'task.+search')!;
        await expect(capability.preview({})).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(capability.execute({ due: '2026-10-31,2026-10-01' }, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(start).not.toHaveBeenCalled();
    });
    it('resolves the current user for relationship filtering instead of treating accountId as open_id', async () => {
        const { output, request } = await run('get-related-tasks', { 'created-by-me': true, 'followed-by-me': true }, [
            { open_id: 'ou_me' },
            { items: [{ guid: 'yes', creator: { id: 'ou_me' }, members: [{ id: 'ou_me', role: 'Follower' }] }, { guid: 'no', creator: { id: 'a' } }], has_more: false },
        ]);
        expect(request.mock.calls[0]![0].path).toBe('/open-apis/authen/v1/user_info');
        expect((output as JsonObject).items).toHaveLength(1);
        expect((output as JsonObject).items[0].guid).toBe('yes');
    });
});

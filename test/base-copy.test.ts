import { afterEach, expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import { basePrograms } from '../src/capabilities/base/programs';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
const args = { 'base-token': 'b', 'table-id': 't', name: 'Copy' };
afterEach(() => vi.useRealTimers());
async function run(input: JsonObject, responses: unknown[]) {
    const request = vi.fn(); responses.forEach(data => request.mockResolvedValueOnce(data));
    const program = basePrograms().find(p => p.id === 'base-table-copy')!;
    let state: JsonObject = { args: input, phase: 'start' };
    vi.useFakeTimers(); vi.setSystemTime(100000);
    for (let i = 0; i < 8; i++) {
        const result = await program.step(state, { lark: { request } } as unknown as CommandContext);
        if (result.done) return { output: result.output, request };
        state = result.state; vi.setSystemTime(Date.now() + 31000);
    }
    throw new Error('Copy did not terminate.');
}
it('copies schema only by default and preserves result table', async () => {
    const result = await run(args, [{ table: { id: 'new', name: 'Copy' }, state: 'success' }]);
    expect(result.output).toEqual({ table: { id: 'new', name: 'Copy' }, range: 'schema', state: 'success', completed: true });
    expect(result.request.mock.calls[0]![0].body).toEqual({ name: 'Copy', range: 'schema' });
});
it('returns an asynchronous task instead of resubmitting all-range copies', async () => {
    const result = await run({ ...args, range: 'all' }, [{ table: { id: 'new' }, state: 'process', task_id: 'opaque' }]);
    expect(result.output).toMatchObject({ completed: false, task_id: 'opaque', next_action: 'poll_status', next_command: { command: 'base.+table-copy-status', args: { 'base-token': 'b', 'task-id': 'opaque' } } });
    expect(result.request).toHaveBeenCalledTimes(1);
});
it('polls a durable task and preserves timeout evidence', async () => {
    const result = await run({ ...args, range: 'all', wait: true }, [{ table: { id: 'new' }, state: 'init', task_id: 'task' }, { table_id: 'new', state: 'process' }, { table_id: 'new', state: 'success' }]);
    expect(result.output).toMatchObject({ completed: true, task_id: 'task', state: 'success' });
    expect(result.request.mock.calls.map(c => c[0].path)).toEqual(['/open-apis/base/v3/bases/b/tables/t/copy', '/open-apis/base/v3/bases/b/copy_table_state', '/open-apis/base/v3/bases/b/copy_table_state']);
    expect((await run({ ...args, range: 'all', wait: true, timeout: '1s' }, [{ table: { id: 'new' }, state: 'init', task_id: 'task' }])).output).toMatchObject({ completed: false, timed_out: true, state: 'init' });
});
it('rejects incompatible copy flags and malformed upstream status', async () => {
    await expect(run({ ...args, wait: true }, [])).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(run({ ...args, timeout: '1m' }, [])).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(run(args, [{ table: { id: 'new' }, state: 'failed' }])).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
});
it('queries one opaque task status without copying again', async () => {
    const request = vi.fn().mockResolvedValue({ table_id: 'new', state: 'success' });
    const capability = baseCapabilities().find(c => c.definition.id === 'base.+table-copy-status')!;
    expect(await capability.execute({ 'base-token': 'b', 'task-id': 'task' }, { lark: { request } } as unknown as CommandContext)).toMatchObject({ completed: true, table: { id: 'new' }, task_id: 'task' });
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/open-apis/base/v3/bases/b/copy_table_state', body: { task_id: 'task' } });
});
it('retries transient status reads and preserves recovery data on terminal poll failures', async () => {
    const { ServiceError } = await import('../src/domain/errors');
    vi.useFakeTimers(); vi.setSystemTime(100000);
    const request = vi.fn().mockRejectedValueOnce(new ServiceError('UPSTREAM_ERROR', 'Temporary', 503)).mockRejectedValueOnce(new ServiceError('FORBIDDEN', 'Denied', 403));
    const program = basePrograms().find(p => p.id === 'base-table-copy')!;
    const state = { args: { ...args, range: 'all', wait: true }, phase: 'poll', table: { id: 'new' }, taskId: 'task', status: 'process', deadline: 200000, eligible: 100000, delay: 3000 };
    const first = await program.step(state, { lark: { request } } as unknown as CommandContext);
    expect(first.done).toBe(false);
    if (first.done) throw new Error('Expected pending');
    vi.setSystemTime(110000);
    const second = await program.step(first.state, { lark: { request } } as unknown as CommandContext);
    expect(second).toMatchObject({ done: true, output: { completed: false, task_id: 'task', state: 'process', error: { code: 'FORBIDDEN' }, next_action: 'poll_status' } });
});
it('exposes poll eligibility to the shared durable scheduler', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const request = vi.fn().mockResolvedValue({ table: { id: 'new' }, state: 'init', task_id: 'task' });
    const program = basePrograms().find(p => p.id === 'base-table-copy')!;
    const result = await program.step({ phase: 'submit', args: { ...args, range: 'all', wait: true, duration: 60000 } }, { lark: { request } } as unknown as CommandContext);
    expect(result).toMatchObject({ done: false, nextRunAt: 4000 });
});

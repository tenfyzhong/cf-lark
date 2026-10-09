import { expect, it, vi } from 'vitest';
import { WorkflowService } from '../src/application/workflows';
import type { WorkflowProgram, WorkflowRecord, WorkflowStore } from '../src/ports/workflows';
import type { Grant } from '../src/domain/models';
const grant: Grant = { id: 'g', domains: ['drive'], permissions: ['read', 'write'], profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], revoked: false, expiresAt: 20000 };
const selection = { profileId: 'p', accountId: 'a', identity: 'user' as const };
function setup(timing: { nextRunAt?: number; retryAfter?: number }) {
    const rows = new Map<string, WorkflowRecord>(); let now = 1000;
    const transition = vi.fn(async (record: WorkflowRecord, revision: number) => { const old = rows.get(record.id); if (!old || old.revision !== revision) return false; rows.set(record.id, structuredClone(record)); return true; });
    const store: WorkflowStore = { create: async record => { rows.set(record.id, structuredClone(record)); }, get: async (owner, id) => { const record = rows.get(id); return record?.owner === owner ? structuredClone(record) : undefined; }, transition };
    const step = vi.fn<WorkflowProgram['step']>().mockResolvedValueOnce({ done: false, state: { phase: 'poll' }, ...timing }).mockResolvedValueOnce({ done: true, output: { complete: true } });
    const client = vi.fn(async () => ({ request: vi.fn() }));
    const service = new WorkflowService(store, [{ id: 'poll', version: 1, domain: 'drive', risk: 'write', identities: ['user'], step }], client, () => now);
    return { service, step, client, rows, transition, time: (value: number) => { now = value; } };
}
it.each([{ nextRunAt: 3000 }, { retryAfter: 2000 }])('persists scheduling and avoids early upstream work for %j', async timing => {
    const f = setup(timing); const first = await f.service.start('poll', {}, selection, grant);
    expect(first).toMatchObject({ status: 'pending', nextRunAt: 3000, retryAfter: 2000 });
    expect(f.rows.get(first.workflowId)).toMatchObject({ nextRunAt: 3000 });
    f.time(2000);
    expect(await f.service.resume(first.workflowId, grant)).toMatchObject({ status: 'pending', retryAfter: 1000, nextRunAt: 3000 });
    expect(f.client).toHaveBeenCalledTimes(1); expect(f.step).toHaveBeenCalledTimes(1); expect(f.transition).toHaveBeenCalledTimes(2);
    f.time(3000);
    expect(await f.service.resume(first.workflowId, grant)).toMatchObject({ status: 'completed', output: { complete: true } });
    expect(f.step).toHaveBeenCalledTimes(2);
});
it('rechecks revocation and selection before returning an early pending result', async () => {
    const f = setup({ retryAfter: 2000 }); const first = await f.service.start('poll', {}, selection, grant);
    await expect(f.service.resume(first.workflowId, { ...grant, revoked: true })).rejects.toMatchObject({ code: 'GRANT_EXPIRED' });
    await expect(f.service.resume(first.workflowId, grant, { ...selection, accountId: 'other' })).rejects.toMatchObject({ code: 'SELECTION_REQUIRED' });
    expect(f.step).toHaveBeenCalledTimes(1);
});
it('clears an old schedule when the next pending step is immediately eligible', async () => {
    const f = setup({ retryAfter: 2000 }); const first = await f.service.start('poll', {}, selection, grant);
    f.step.mockReset().mockResolvedValueOnce({ done: false, state: { phase: 'next' } }).mockResolvedValueOnce({ done: true, output: 'done' }); f.time(3000);
    expect(await f.service.resume(first.workflowId, grant)).toEqual({ workflowId: first.workflowId, selection, status: 'pending' });
    expect(f.rows.get(first.workflowId)?.nextRunAt).toBeUndefined();
    expect(await f.service.resume(first.workflowId, grant)).toMatchObject({ status: 'completed' });
});
it.each([{ retryAfter: -1 }, { nextRunAt: Number.NaN }, { nextRunAt: 3000, retryAfter: 100 }])('rejects invalid schedules %j', async timing => {
    const f = setup(timing);
    await expect(f.service.start('poll', {}, selection, grant)).rejects.toMatchObject({ code: 'INVALID_WORKFLOW_SCHEDULE' });
});

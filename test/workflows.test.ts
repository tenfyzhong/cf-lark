import { expect, it, vi } from 'vitest';
import { WorkflowService } from '../src/application/workflows';
import type { WorkflowRecord, WorkflowStore, WorkflowProgram } from '../src/ports/workflows';
import type { Grant } from '../src/domain/models';

const grant: Grant = { id: 'grant', revoked: false, expiresAt: 10_000,
    profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], domains: ['drive'], permissions: ['read', 'write'] };
function setup() {
    const rows = new Map<string, WorkflowRecord>();
    const store: WorkflowStore = {
        create: async (record) => { rows.set(record.id, structuredClone(record)); },
        get: async (owner, id) => { const value = rows.get(id); return value?.owner === owner ? structuredClone(value) : undefined; },
        transition: async (record, revision) => {
            const old = rows.get(record.id);
            if (!old || old.owner !== record.owner || old.revision !== revision) return false;
            rows.set(record.id, structuredClone(record)); return true;
        },
    };
    const step = vi.fn(async (state: Record<string, unknown>) => state.phase === 'finish'
        ? { done: true as const, output: { file_token: 'file' } }
        : { done: false as const, state: { phase: 'finish' } });
    const program: WorkflowProgram = { id: 'drive-upload', version: 1, domain: 'drive', risk: 'write', identities: ['user'], step };
    const client = vi.fn(async () => ({ request: vi.fn() }));
    const service = new WorkflowService(store, [program], client, () => 1000);
    return { service, step, client, rows };
}
it('advances one step per resume and replays completed results without upstream effects', async () => {
    const { service, step, client } = setup();
    const started = await service.start('drive-upload', { phase: 'start' }, { profileId: 'p', accountId: 'a', identity: 'user' }, grant);
    expect(started).toMatchObject({ status: 'pending', workflowId: expect.any(String) });
    expect(step).toHaveBeenCalledTimes(1);
    expect(await service.resume(started.workflowId, grant)).toMatchObject({ status: 'completed', output: { file_token: 'file' } });
    expect(await service.resume(started.workflowId, grant)).toMatchObject({ status: 'completed' });
    expect(step).toHaveBeenCalledTimes(2);
    expect(client).toHaveBeenCalledWith({ profileId: 'p', accountId: 'a', identity: 'user' });
});
it('checks grant ownership, current permissions and original selection before resuming', async () => {
    const { service, step } = setup();
    const result = await service.start('drive-upload', {}, { profileId: 'p', accountId: 'a', identity: 'user' }, grant);
    await expect(service.resume(result.workflowId, { ...grant, id: 'other' })).rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND' });
    for (const denied of [{ ...grant, domains: [] }, { ...grant, permissions: ['read'] }, { ...grant, profiles: [] }]) {
        await expect(service.resume(result.workflowId, denied as Grant)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(service.resume(result.workflowId, { ...grant, revoked: true })).rejects.toMatchObject({ code: 'GRANT_EXPIRED' });
    expect(step).toHaveBeenCalledTimes(1);
});
it('persists an uncertain state and never retries an interrupted write', async () => {
    const { service, step, rows } = setup();
    step.mockRejectedValueOnce(new Error('Connection lost'));
    await expect(service.start('drive-upload', {}, { profileId: 'p', accountId: 'a', identity: 'user' }, grant)).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
    const record = [...rows.values()][0]!;
    expect(record.status).toBe('uncertain');
    await expect(service.resume(record.id, grant)).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
    expect(step).toHaveBeenCalledTimes(1);
});
it('excludes concurrent resumes before an asynchronous step completes', async () => {
    const { service, step, rows } = setup();
    let finish!: () => void;
    step.mockImplementationOnce(async () => { await new Promise<void>((resolve) => { finish = resolve; }); return { done: true, output: { file_token: 'done' } }; });
    const starting = service.start('drive-upload', {}, { profileId: 'p', accountId: 'a', identity: 'user' }, grant);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const record = [...rows.values()][0]!;
    await expect(service.resume(record.id, grant)).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
    finish(); await starting;
    expect(step).toHaveBeenCalledTimes(1);
});

it('requires an explicit resume identity to match the stored execution selection', async () => {
    const { service, step } = setup();
    const started = await service.start('drive-upload', {}, { profileId: 'p', accountId: 'a', identity: 'user' }, grant);
    expect(started).toMatchObject({ selection: { profileId: 'p', accountId: 'a', identity: 'user' } });
    await expect(service.resume(started.workflowId, grant, { profileId: 'p', identity: 'bot' })).rejects.toMatchObject({ code: 'SELECTION_REQUIRED' });
    expect(step).toHaveBeenCalledTimes(1);
});

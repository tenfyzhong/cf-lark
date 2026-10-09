import { expect, it, vi } from 'vitest';
import { appsCapabilities } from '../src/capabilities/apps/commands';
import { appsPrograms } from '../src/capabilities/apps/programs';
import type { CommandContext } from '../src/ports/capabilities';
function setup(name: string, responses: unknown[]) {
    const request = vi.fn(); responses.forEach((value) => request.mockResolvedValueOnce(value));
    const program = appsPrograms().find((item) => item.id === `apps-${name}`)!;
    const context = { lark: { request } } as unknown as CommandContext;
    return { request, step: (state: any) => program.step(state, context) };
}
it('registers migration and recovery with write scope even for read previews', () => {
    for (const name of ['db-env-diff', 'db-env-migrate', 'db-recovery-diff', 'db-recovery-apply']) {
        expect(appsCapabilities().find((c) => c.definition.id === `apps.+${name}`)?.definition.scopes).toEqual(['spark:app:write']);
    }
});
it('checkpoints migration preview and submission before polling', async () => {
    vi.useFakeTimers();
    try {
        const f = setup('db-env-migrate', [{ from: 'dev', to: 'online', changes: [{}, {}] }, { task_id: 't' }, { status: 'success' }]);
        let result = await f.step({ args: { 'app-id': 'a', yes: true }, phase: 'prepare' });
        expect(result.done).toBe(false);
        result = await f.step((result as any).state);
        expect(f.request.mock.calls[1]![0].body).toEqual({ dry_run: false });
        const state = (result as any).state;
        expect(await f.step(state)).toEqual({ done: false, state });
        expect(f.request).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(1000);
        expect(await f.step(state)).toEqual({ done: true, output: { status: 'migrated', from: 'dev', to: 'online', changes_applied: 2 } });
        expect(f.request.mock.calls[2]![0].query).toEqual({ task_id: 't' });
    } finally { vi.useRealTimers(); }
});
it('recovery diff normalizes and retains target and removes redundant table rows', async () => {
    vi.useFakeTimers();
    try {
        const f = setup('db-recovery-diff', [{ preview_request_id: 'p' }, { preview_status: 'success', changes: [{ table: 'a', inserted: 3 }, { table: 'a', action: 'restore_table' }, { table: 'b', deleted: 2 }] }]);
        const first = await f.step({ args: { 'app-id': 'a', environment: 'dev', target: '2026-10-08' }, phase: 'prepare' });
        expect(f.request.mock.calls[0]![0].body).toEqual({ target: '2026-10-08T00:00:00Z', dry_run: true });
        vi.advanceTimersByTime(1000);
        expect(await f.step((first as any).state)).toEqual({ done: true, output: { target: '2026-10-08T00:00:00Z', tables_affected: 2, changes: [{ table: 'a', action: 'restore_table' }, { table: 'b', deleted: 2 }], estimated_seconds: 30 } });
        expect(f.request.mock.calls[1]![0].query).toEqual({ env: 'dev', preview_request_id: 'p' });
    } finally { vi.useRealTimers(); }
});
it('guards apply before side effects and handles no_changes synchronously', async () => {
    const f = setup('db-recovery-apply', [{ status: 'no_changes' }]);
    await expect(f.step({ args: { 'app-id': 'a', target: '2026-10-08' }, phase: 'prepare' })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(f.request).not.toHaveBeenCalled();
    expect(await f.step({ args: { 'app-id': 'a', target: '2026-10-08', yes: true }, phase: 'prepare' })).toEqual({ done: true, output: { status: 'no_changes', target: '2026-10-08T00:00:00Z' } });
});
it('stops expired polling and failed upstream jobs without repeating submission', async () => {
    const f = setup('db-env-migrate', []);
    await expect(f.step({ args: { 'app-id': 'a', yes: true }, phase: 'poll', deadline: 1 })).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
    expect(f.request).not.toHaveBeenCalled();
    const failed = setup('db-recovery-apply', [{ status: 'failed' }]);
    await expect(failed.step({ args: { 'app-id': 'a', yes: true, target: '2026-10-08' }, phase: 'poll', deadline: Date.now() + 10000, target: '2026-10-08T00:00:00Z' })).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
});

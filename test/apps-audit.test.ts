import { expect, it, vi } from 'vitest';
import { appsCapabilities } from '../src/capabilities/apps/commands';
import { appsPrograms } from '../src/capabilities/apps/programs';
import type { CommandContext } from '../src/ports/capabilities';
it('projects changelog fields and normalizes time filters', async () => {
    const request = vi.fn().mockResolvedValue({ items: [{ change_id: 'c', operator: '{"id":"u","name":"User","extra":1}', statement: 'DDL', extra: 1 }] });
    const c = appsCapabilities().find((c) => c.definition.id === 'apps.+db-changelog-list')!;
    expect(await c.execute({ 'app-id': 'a', since: '2026-10-08' }, { lark: { request } } as any)).toEqual({ items: [{ change_id: 'c', changed_at: '', operator: { id: 'u', name: 'User' }, target_table: '', change_type: '', summary: '', statement: 'DDL' }] });
    expect(request.mock.calls[0]![0].query).toEqual({ page_size: 20, since: '2026-10-08T00:00:00Z' });
});
it('filters multi-table audits through paginated schema and audit settings', async () => {
    const request = vi.fn().mockResolvedValueOnce({ items: [{ name: 'a' }], has_more: true, page_token: 'n' }).mockResolvedValueOnce({ items: [{ name: 'b' }], has_more: false }).mockResolvedValueOnce({ items: [{ table: 'a', enabled: true }] }).mockResolvedValueOnce({ items: [{ event_id: 'e', after: '{"x":1}' }], skipped: ['incorrect'] });
    const program = appsPrograms().find((p) => p.id === 'apps-db-audit-list')!;
    const context = { lark: { request } } as unknown as CommandContext;
    let result: any = { state: { args: { 'app-id': 'a', table: ['a', 'b', 'c'] }, phase: 'schema' } };
    for (let i = 0; i < 4; i++) result = await program.step(result.state, context);
    expect(result).toEqual({ done: true, output: { items: [{ event_id: 'e', event_time: '', target_table: '', type: '', summary: '', after: { x: 1 } }], skipped: [{ table: 'b', reason: 'audit not enabled' }, { table: 'c', reason: 'table not found' }] } });
    expect(request.mock.calls[3]![0].query.tables).toBe('a');
});
it('normalizes enabled audit status and retries only classified contention', async () => {
    vi.useFakeTimers();
    try {
        const request = vi.fn().mockRejectedValueOnce({ details: { reason: 'dts_lock_contention' } }).mockResolvedValueOnce({ status: {} });
        const program = appsPrograms().find((p) => p.id === 'apps-db-audit-enable')!;
        const context = { lark: { request } } as unknown as CommandContext;
        const result: any = await program.step({ args: { 'app-id': 'a', table: ' t ', retention: '30d' } }, context);
        expect(result.done).toBe(false);
        await program.step(result.state, context); expect(request).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(500);
        expect(await program.step(result.state, context)).toEqual({ done: true, output: { table: 't', enabled: true, retention: '30d' } });
        expect(request.mock.calls[1]![0].body).toEqual({ table: 't', enabled: true, retention: '30d' });
    } finally { vi.useRealTimers(); }
});
it('freezes relative audit time filters before schema pagination', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T00:00:00Z'));
    try {
        const request = vi.fn().mockResolvedValueOnce({ items: [{ name: 'a' }, { name: 'b' }], has_more: false }).mockResolvedValueOnce({ items: [{ table: 'a', enabled: true }] }).mockResolvedValueOnce({ items: [] });
        const program = appsPrograms().find((p) => p.id === 'apps-db-audit-list')!, context = { lark: { request } } as unknown as CommandContext;
        let step: any = await program.step({ args: { 'app-id': 'a', table: ['a', 'b'], since: '1h' }, phase: 'schema' }, context);
        vi.advanceTimersByTime(60000); step = await program.step(step.state, context);
        vi.advanceTimersByTime(60000); await program.step(step.state, context);
        expect(request.mock.calls[2]![0].query.since).toBe('2026-10-08T23:00:00Z');
    } finally { vi.useRealTimers(); }
});

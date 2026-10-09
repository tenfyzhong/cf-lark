import { expect, it, vi } from 'vitest';
import { calendarMutationProgram } from '../src/capabilities/calendar/mutation';
import { recurringScope, pivotMidnight, truncateRule } from '../src/capabilities/calendar/recurring';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
it('requires explicit recurring scope and truncates in the event timezone', () => {
    expect(() => recurringScope({ recurrence: 'FREQ=DAILY' }, 'uid_0', '')).toThrow('apply-to');
    expect(() => recurringScope({ is_exception: true }, 'uid_123', 'this-and-following')).toThrow();
    const midnight = pivotMidnight(1790830800, 'Asia/Shanghai');
    expect(new Date(midnight * 1000).toISOString()).toBe('2026-09-30T16:00:00.000Z');
    expect(truncateRule('RRULE:FREQ=DAILY;COUNT=10', midnight)).toBe('RRULE:FREQ=DAILY;UNTIL=20260930T160000Z');
});
it('deletes exceptions including cancelled placeholders before the recurring master', async () => {
    const request = vi.fn(async (r: { method: string; path: string }) => r.path.endsWith('/instances') ? { items: [{ event_id: 'uid_1800000000', is_exception: true, status: 'cancelled' }] } : r.method === 'GET' ? { event: { event_id: 'uid_0', recurrence: 'FREQ=DAILY;COUNT=2', start_time: { timestamp: '1790812800' } } } : {});
    const context = { lark: { request } } as unknown as CommandContext;
    let state: JsonObject = { action: 'delete', args: { 'event-id': 'uid_0', 'apply-to': 'all', notify: false }, phase: 'read' };
    for (let i = 0; i < 30; i++) { const result = await calendarMutationProgram().step(state, context); if (result.done) { expect(result.output).toMatchObject({ apply_to: 'all', deleted_event: { event_id: 'uid_0' } }); break; } state = result.state; }
    const deletes = request.mock.calls.map(call => call[0]).filter(r => r.method === 'DELETE');
    expect(deletes).toMatchObject([{ path: expect.stringContaining('uid_1800000000'), query: { delete_exception: true, need_notification: false } }, { path: expect.stringContaining('uid_0'), query: { need_notification: false } }]);
});
it('blocks an update when a requested room needs approval before writes', async () => {
    const request = vi.fn(async (r: { method: string }) => r.method === 'GET' ? { event: { event_id: 'uid_0', start_time: { timestamp: '1790812800' }, end_time: { timestamp: '1790816400' } } } : { room_availabilitys: [{ room_id: 'omm_x', status: 'need_approval' }] });
    const context = { lark: { request } } as unknown as CommandContext;
    let state: JsonObject = { action: 'update', args: { 'event-id': 'uid_0', 'add-attendee-ids': 'omm_x' }, phase: 'read' };
    let failure: unknown;
    for (let i = 0; i < 10; i++) { try { const result = await calendarMutationProgram().step(state, context); if (result.done) break; state = result.state; } catch (error) { failure = error; break; } }
    expect(failure).toMatchObject({ code: 'ROOM_UNAVAILABLE' });
    expect(request.mock.calls.some(call => call[0].method === 'PATCH')).toBe(false);
});
it('recreates following series and inherits all supported attendees without count reset', async () => {
    const request = vi.fn(async (r: { method: string; path: string }) => {
        if (r.path.endsWith('/instances')) return { items: [] };
        if (r.path.endsWith('/attendees') && r.method === 'GET') return { items: [{ type: 'third_party', third_party_email: 'guest@example.org' }, { type: 'user', user_id: 'ou_old', is_optional: true }] };
        if (r.path.endsWith('/events') && r.method === 'POST') return { event: { event_id: 'new_0' } };
        if (r.method === 'GET') return { event: { event_id: r.path.endsWith('uid_0') ? 'uid_0' : 'uid_1790812800', ...(r.path.endsWith('uid_0') ? { recurrence: 'FREQ=DAILY;COUNT=3' } : {}), start_time: { timestamp: '1790812800' }, end_time: { timestamp: '1790816400' } } };
        return {};
    });
    let state: JsonObject = { action: 'update', args: { 'event-id': 'uid_1790812800', 'apply-to': 'this-and-following', summary: 'New', 'remove-attendee-ids': 'ou_old', 'add-attendee-ids': 'ou_new' }, phase: 'read' };
    for (let i = 0; i < 30; i++) { const result = await calendarMutationProgram().step(state, { lark: { request } } as unknown as CommandContext); if (result.done) break; state = result.state; }
    expect(request.mock.calls.find(call => call[0].path.endsWith('/events'))?.[0]).toMatchObject({ body: { recurrence: 'FREQ=DAILY', summary: 'New' } });
    expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ body: { attendees: [{ type: 'third_party', third_party_email: 'guest@example.org' }, { type: 'user', user_id: 'ou_new' }] } });
});
it('preserves all-day exception times when supplied dates are unchanged', async () => {
    const request = vi.fn(async (r: { method: string; path: string }) => r.path.endsWith('/instances') ? { items: [{ event_id: 'uid_1790899200', is_exception: true }] } : r.method === 'GET' ? { event: { event_id: 'uid_0', recurrence: 'FREQ=DAILY;COUNT=2', start_time: { date: '2026-10-01' }, end_time: { date: '2026-10-02' } } } : { event: { event_id: 'uid_0', summary: 'Same time' } });
    let state: JsonObject = { action: 'update', args: { 'event-id': 'uid_0', 'apply-to': 'all', start: '2026-10-01', end: '2026-10-02', summary: 'Same time' }, phase: 'read' };
    let output: unknown;
    for (let i = 0; i < 30; i++) { const result = await calendarMutationProgram().step(state, { lark: { request } } as unknown as CommandContext); if (result.done) { output = result.output; break; } state = result.state; }
    expect(request.mock.calls.some(call => call[0].method === 'DELETE')).toBe(false);
    expect(output).toMatchObject({ updated_event: { attendees_added_count: 0, attendees_removed_count: 0, summary: 'Same time' } });
});
it('does not swallow unknown mutation outcomes while processing exceptions', async () => {
    const request = vi.fn(async () => { throw new Error('connection lost'); });
    const state: JsonObject = { action: 'delete', args: { 'event-id': 'uid_0' }, scope: 'all', phase: 'write', index: 0, queue: [{ exceptionId: 'uid_123', request: { method: 'DELETE', path: '/event' } }], failures: [] };
    await expect(calendarMutationProgram().step(state, { lark: { request } } as unknown as CommandContext)).rejects.toThrow('connection lost');
});
it('checkpoints rate-limited exception writes without replay before backoff', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    const { ServiceError } = await import('../src/domain/errors');
    const request = vi.fn(async () => { throw new ServiceError('UPSTREAM_ERROR', 'Rate limited', 502, { upstreamCode: 190004 }); });
    const state: JsonObject = { action: 'delete', args: { 'event-id': 'uid_0' }, scope: 'all', phase: 'write', index: 0, queue: [{ exceptionId: 'uid_123', request: { method: 'DELETE', path: '/event' } }], failures: [] };
    const result = await calendarMutationProgram().step(state, { lark: { request } } as unknown as CommandContext);
    expect(result).toMatchObject({ done: false, state: { index: 0, retry: 1, failures: [] } });
    if (!result.done) await calendarMutationProgram().step(result.state, { lark: { request } } as unknown as CommandContext);
    expect(request).toHaveBeenCalledTimes(1); vi.restoreAllMocks();
});
it('keeps only one exception operation in a checkpoint queue', async () => {
    const result = await calendarMutationProgram().step({ action: 'delete', args: { 'event-id': 'uid_0' }, scope: 'all', mid: 'uid_0', phase: 'queue', exceptions: Array.from({ length: 1000 }, (_, i) => ({ event_id: `uid_${i+1}`, start: i+1 })) }, {} as CommandContext);
    if (result.done) throw new Error('Expected checkpoint');
    expect((result.state.queue as unknown[]).length).toBe(1);
});
it('uses moved exception start times for tail cleanup and limits scans to 5000 exceptions', async () => {
    const request = vi.fn(async () => ({ items: [{ event_id: 'uid_100', is_exception: true, start_time: { timestamp: '300' } }] }));
    const state: JsonObject = { action: 'delete', args: { 'event-id': 'uid_200' }, scope: 'this-and-following', phase: 'scan', mid: 'uid_0', scanStart: 100, scanEnd: 500, exceptions: [] };
    const result = await calendarMutationProgram().step(state, { lark: { request } } as unknown as CommandContext);
    expect(result).toMatchObject({ state: { exceptions: [{ event_id: 'uid_100' }] } });
    await expect(calendarMutationProgram().step({ ...state, exceptions: Array.from({ length: 5001 }, (_, i) => ({ event_id: `uid_${i+1}` })) }, { lark: { request } } as unknown as CommandContext)).rejects.toThrow('5000');
});
it('projects update output with start/end strings and source attendee count keys', async () => {
    const result = await calendarMutationProgram().step({ action: 'update', args: { 'event-id': 'uid_0' }, phase: 'done', mid: 'uid_0', scope: 'single', updated: { event_id: 'uid_0', summary: 'Meeting', start_time: { timestamp: '1790812800' }, end_time: { timestamp: '1790816400' }, description_rich: '**Rich**', private_unknown: 1 } }, {} as CommandContext);
    expect(result).toMatchObject({ output: { updated_event: { start: '2026-10-01T00:00:00Z', end: '2026-10-01T01:00:00Z', description: '**Rich**', attendees_added_count: 0 } } });
    if (result.done) expect((result.output as JsonObject).updated_event).not.toHaveProperty('private_unknown');
});
it('requests existing room attendees before a time change precheck', async () => {
    const request = vi.fn(async (_request: { method: string }) => ({ event: { event_id: 'uid_0' } }));
    await calendarMutationProgram().step({ action: 'update', args: { 'event-id': 'uid_0', start: '2026-10-01', end: '2026-10-02' }, phase: 'read' }, { lark: { request } } as unknown as CommandContext);
    expect(request.mock.calls[0]?.[0]).toMatchObject({ query: { user_id_type: 'open_id', need_attendee: true, max_attendee_num: 20 } });
});

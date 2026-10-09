import { expect, it, vi } from 'vitest';
import { calendarCreateProgram } from '../src/capabilities/calendar/create';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
import { ServiceError } from '../src/domain/errors';
it('creates rich descriptions, includes the caller, and compensates a failed invite', async () => {
    const request = vi.fn(async (r: { method: string; path: string }) => { if (r.path.endsWith('user_info')) return { open_id: 'ou_me' }; if (r.path.endsWith('/attendees')) throw new ServiceError('LARK_API_ERROR', 'Invite denied'); if (r.method === 'POST') return { event: { event_id: 'uid_0' } }; return {}; });
    const context = { lark: { request }, selection: { identity: 'user' } } as unknown as CommandContext;
    let state: JsonObject = { args: { summary: 'Meeting', start: '2026-10-01', end: '2026-10-02', description: '**Rich**', 'attendee-ids': 'ou_a' }, phase: 'create' };
    let failure: unknown;
    for (let i = 0; i < 8; i++) { try { const step = await calendarCreateProgram().step(state, context); if (step.done) break; state = step.state; } catch (error) { failure = error; break; } }
    expect(failure).toMatchObject({ code: 'LARK_API_ERROR', message: expect.stringContaining('rolled back') });
    expect(request.mock.calls[0]![0]).toMatchObject({ body: { description_rich: '**Rich**', reminders: [{ minutes: 5 }] } });
    expect(request.mock.calls[2]![0]).toMatchObject({ body: { attendees: [{ type: 'user', user_id: 'ou_a' }, { type: 'user', user_id: 'ou_me' }] } });
    expect(request.mock.calls[3]![0]).toMatchObject({ method: 'DELETE', query: { need_notification: false } });
});
it('does not compensate an invitation whose mutation outcome is unknown', async () => {
    const request = vi.fn(async () => { throw new Error('connection lost'); });
    await expect(calendarCreateProgram().step({ args: {}, phase: 'attendees', event: { event_id: 'uid_0' }, attendees: [] }, { lark: { request } } as unknown as CommandContext)).rejects.toThrow('connection lost');
});

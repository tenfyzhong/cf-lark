import { expect, it, vi } from 'vitest';
import { calendarAvailabilityCapabilities, calendarAvailabilityPrograms } from '../src/capabilities/calendar/availability';
import type { CommandContext } from '../src/ports/capabilities';
import type { ApiRequest } from '../src/ports/lark';
import type { JsonObject } from '../src/domain/models';
const ctx = (request: CommandContext['lark']['request'], identity: 'bot' | 'user' = 'bot') => ({ lark: { request }, selection: { profileId: 'p', identity }, grant: {} } as unknown as CommandContext);
const runner = { start: vi.fn(), resume: vi.fn() };
it('merges adjacent busy intervals and derives shared free gaps with minimum duration', async () => {
    const request = vi.fn(async (_r: ApiRequest) => ({ freebusy_lists: [{ user_id: 'ou_a', freebusy_items: [{ start_time: '2026-10-01T08:00:00Z', end_time: '2026-10-01T09:00:00Z' }, { start_time: '2026-10-01T09:00:00Z', end_time: '2026-10-01T10:00:00Z' }] }, { user_id: 'ou_b', freebusy_items: [{ start_time: '2026-10-01T11:00:00Z', end_time: '2026-10-01T11:30:00Z' }] }] }));
    const command = calendarAvailabilityCapabilities(runner).find(c => c.definition.id === 'calendar.+freebusy')!;
    const args = { start: '2026-10-01T08:00:00Z', end: '2026-10-01T12:00:00Z', 'user-id': ['ou_a', 'ou_b'] };
    expect(await command.execute({...args, 'min-duration':'0'}, ctx(request))).toMatchObject({ users: [{ busy: [{ start_time: '2026-10-01T08:00:00Z', end_time: '2026-10-01T10:00:00Z' }] }, { user_id: 'ou_b' }] });
    expect(await command.execute({ ...args, type: 'common_free', 'min-duration': '45m' }, ctx(request))).toMatchObject({ common_free: [{ start_time: '2026-10-01T10:00:00Z', end_time: '2026-10-01T11:00:00Z', duration: '1h0m0s' }] });
});
it('adds the current user to suggestions once and splits chat attendees', async () => {
    const request = vi.fn(async (r: ApiRequest) => r.path.endsWith('user_info') ? { open_id: 'ou_me' } : { suggestions: [] });
    const command = calendarAvailabilityCapabilities(runner).find(c => c.definition.id === 'calendar.+suggestion')!;
    await command.execute({ start: '2026-10-01T08:00:00Z', 'attendee-ids': 'ou_me,oc_c', 'duration-minutes': 30, exclude: '2026-10-01T10:00:00Z~2026-10-01T11:00:00Z' }, ctx(request, 'user'));
    expect(request.mock.calls[1]![0].body).toMatchObject({ attendee_user_ids: ['ou_me'], attendee_chat_ids: ['oc_c'], duration_minutes: 30, search_end_time: '2026-10-01T23:59:59Z', excluded_event_times: [{ event_start_time: '2026-10-01T10:00:00Z' }] });
});
it('finds rooms one slot per checkpoint with sorted output and empty-slot hints', async () => {
    const request = vi.fn(async (_r: ApiRequest) => ({ available_rooms: [] }));
    const program = calendarAvailabilityPrograms()[0]!;
    let state: JsonObject = { args: { slot: ['2026-10-01T12:00:00Z~2026-10-01T13:00:00Z', '2026-10-01T08:00:00Z~2026-10-01T09:00:00Z'], 'room-name': ' One, Two ' }, index: 0, results: [], phase: 'rooms' };
    for (let i = 0; i < 3; i++) { const result = await program.step(state, ctx(request)); if (result.done) { expect(result.output).toMatchObject({ time_slots: [{ start: '2026-10-01T08:00:00Z', meeting_rooms: [], hint: expect.any(String) }, { start: '2026-10-01T12:00:00Z' }] }); break; } state = result.state; }
    expect(request.mock.calls[0]![0].body).toMatchObject({ room_name: 'One,Two' });
});

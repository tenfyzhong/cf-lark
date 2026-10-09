import { expect, it, vi } from 'vitest';
import { calendarCoreCapabilities, calendarCorePrograms } from '../src/capabilities/calendar/core';
import type { CommandContext } from '../src/ports/capabilities';
import type { ApiRequest } from '../src/ports/lark';
import type { JsonObject } from '../src/domain/models';
const runner = { start: vi.fn(), resume: vi.fn() };
const ctx = (request: CommandContext['lark']['request']) => ({ lark: { request }, selection: { profileId: 'p', identity: 'user' }, grant: {} } as unknown as CommandContext);
const command = (id: string) => calendarCoreCapabilities(runner).find(c => c.definition.id === `calendar.+${id}`)!;
it('joins via opaque share token and sends RSVP on primary without resolving another calendar', async () => {
    const request = vi.fn(async (_r: ApiRequest) => ({}));
    expect(await command('join-event').execute({ 'share-token': ' opaque ' }, ctx(request))).toEqual({ joined: true });
    expect(request.mock.calls[0]![0]).toEqual({ method: 'POST', path: '/open-apis/calendar/v4/calendars/join_event', body: { share_token: 'opaque' } });
    expect(await command('rsvp').execute({ 'event-id': 'event_0', 'rsvp-status': 'decline' }, ctx(request))).toEqual({ calendar_id: 'primary', event_id: 'event_0', rsvp_status: 'decline' });
    expect(request.mock.calls[1]![0].path).toContain('/primary/events/event_0/reply');
});
it('projects attendee types while preserving upstream cursor on empty filtered pages', async () => {
    const request = vi.fn(async (_r: ApiRequest) => ({ items: [{ type: 'chat', chat_id: 'oc_c', rsvp_status: 'accept', is_external: false, user_id: 'noise' }], has_more: true, page_token: 'next' }));
    expect(await command('list-attendees').execute({ 'event-id': 'e_0', type: ['chat'], 'page-size': 1 }, ctx(request))).toEqual({ attendees: [{ type: 'chat', chat_id: 'oc_c', is_external: false }], has_more: true, page_token: 'next' });
    expect(await command('list-attendees').execute({ 'event-id': 'e_0', type: ['user'] }, ctx(request))).toEqual({ attendees: [], has_more: true, page_token: 'next' });
    expect(request.mock.calls[0]![0].query).toEqual({ page_size: 10 });
});
it('flattens event details, converts timestamps, and adjusts exclusive all-day end', async () => {
    const request = vi.fn(async () => ({ event: { event_id: 'e_0', description: 'plain', description_rich: '<b>Rich</b>', start_time: { date: '2026-10-01' }, end_time: { date: '2026-10-03' }, status: 'confirmed', create_time: '1700000000' } }));
    expect(await command('get').execute({ 'event-id': 'e_0' }, ctx(request))).toEqual({ event_id: 'e_0', description: '<b>Rich</b>', start_time: { date: '2026-10-01' }, end_time: { date: '2026-10-02' }, create_time: '2023-11-14T22:13:20Z', is_exception: false });
});
it('splits search attendees and defaults the missing date boundary', async () => {
    const request = vi.fn(async (_r: ApiRequest) => ({ items: [{ meta_data: { event_id: 'e', summary: 'Title', start: { date: '2026-10-01' }, end: { date_time: '2026-10-01T10:00:00Z' }, ignored: 1 } }], has_more: false }));
    expect(await command('search-event').execute({ start: '2026-10-01', 'attendee-ids': 'ou_a,oc_c,omm_r' }, ctx(request))).toMatchObject({ items: [{ event_id: 'e', summary: 'Title', start: { date: '2026-10-01' } }] });
    expect(request.mock.calls[0]![0].body).toEqual({ query: '', filter: { attendee_user_ids: ['ou_a'], attendee_chat_ids: ['oc_c'], meeting_room_ids: ['omm_r'], time_range: { start_time: '2026-10-01T00:00:00Z', end_time: '2026-10-01T23:59:59Z' } } });
});
it('checks recurring transfer before mutation and leaves shared-calendar removal outcome unknown', async () => {
    const program = calendarCorePrograms()[0]!;
    const request = vi.fn(async (_r: ApiRequest) => ({ event: { recurrence: 'FREQ=DAILY' } }));
    await expect(program.step({ action: 'transfer', args: { 'event-id': 'e_0', 'to-user-id': 'ou_a' }, phase: 'check' }, ctx(request))).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    const result = await program.step({ action: 'transfer', args: { 'event-id': 'e_0', 'to-user-id': 'ou_a', 'calendar-id': 'shared', 'transfer-series': true }, phase: 'transfer' }, ctx(request));
    expect(result).toMatchObject({ done: true, output: { new_organizer_id: 'ou_a' } });
    if (result.done) expect(result.output).not.toHaveProperty('original_organizer_removed');
    expect(request.mock.calls[1]![0].body).toEqual({ to_user_id: 'ou_a', need_remove_original_organizer: false });
});
it('reads calendar meeting relations one event per resume and retains per-item failures', async () => {
    const request = vi.fn(async (_r: ApiRequest) => ({ instance_relation_infos: [{ meeting_instance_ids: ['meeting'], meeting_notes: ['doc'] }] }));
    const program = calendarCorePrograms()[1]!;
    let state: JsonObject = { args: { 'event-ids': 'e1,e2' }, index: 0, results: [] };
    for (let i = 0; i < 3; i++) { const result = await program.step(state, ctx(request)); if (result.done) { expect(result.output).toMatchObject({ meetings: [{ event_id: 'e1', meeting_id: 'meeting', meeting_note: 'doc' }, { event_id: 'e2' }] }); break; } state = result.state; }
    expect(request).toHaveBeenCalledTimes(2);
});
it('projects typed get fields and drops unknown API properties', async () => {
    const request = vi.fn(async () => ({ event: { event_id: 'uid_0', summary: '', color: 0, unknown: 'hidden', vchat: { vc_type: 'vc', meeting_settings: { owner_id: 'ou_hidden' } }, event_check_in: { enable_check_in: false, need_notify_attendees: false, extra: 1 } } }));
    expect(await command('get').execute({ 'event-id': 'uid_0' }, ctx(request))).toEqual({ event_id: 'uid_0', is_exception: false, vchat: { vc_type: 'vc' }, event_check_in: { enable_check_in: false, need_notify_attendees: false } });
});
it('keeps declared mutation scopes aligned with the pinned CLI',async()=>{
    const {calendarMutationDefinitions}=await import('../src/capabilities/calendar/mutation-definitions');
    expect(calendarMutationDefinitions.find(d=>d.id==='calendar.+update')?.scopes).toEqual(['calendar:calendar.event:update']);
});

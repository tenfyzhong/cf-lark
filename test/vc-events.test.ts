import { expect, it, vi } from 'vitest';
import { vcEventsCapability, vcEventsProgram } from '../src/capabilities/vc/events';
import type { CommandContext } from '../src/ports/capabilities';
import type { ApiRequest } from '../src/ports/lark';
import type { JsonObject } from '../src/domain/models';
it('paginates meeting events in bounded steps, compacts payloads, and derives identities and end state', async () => {
    const replies = [
        { events: [{ event_id: 'e1', event_type: 'participant_joined', event_time: '1700000000', payload: { meeting: { id: '1234567890123456', topic: 'Test', start_time: '1700000000' }, empty: [], participant_joined_items: [{ participant: { id: 'ou_me', user_name: 'Bot', user_type: 1 } }] } }], has_more: true, page_token: 'n' },
        { events: [{ event_id: 'e2', event_time: '1700000100', payload: { activity_event_type: 'participant_left', participant_left_items: [{ leave_reason: 2, leave_time: '1700000100', participant: { id: 'ou_other', role: 1, user_type: 1 } }] } }], has_more: false },
        { bot: { open_id: 'ou_me', app_name: 'Bot' } },
    ];
    const request = vi.fn(async (_r: ApiRequest) => replies.shift() ?? {});
    const context = { lark: { request }, selection: { profileId: 'p', identity: 'bot' }, grant: {} } as unknown as CommandContext;
    let state: JsonObject = { args: { 'meeting-id': '1234567890123456', 'page-all': true }, phase: 'events', events: [], pages: 0 };
    for (let i = 0; i < 5; i++) {
        const before = request.mock.calls.length;
        const result = await vcEventsProgram().step(state, context);
        expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
        if (result.done) {
            expect(result.output).toMatchObject({ meeting: { status: 'ended', end_time: '2023-11-14T22:15:00Z' }, identity: { id: 'ou_me', participant_type: 'bot' }, events: [{ actors: [{ participant_type: 'bot', role: 'bot' }] }, { actors: [{ role: 'host' }] }] });
            expect(JSON.stringify(result.output)).not.toContain('empty');
            expect(request.mock.calls[0]![0].query).toMatchObject({ page_size: '100' });
            return;
        }
        state = result.state;
    }
    throw new Error('Events did not finish.');
});
it('clamps page size and validates preview without requests', async () => {
    const runner = { start: vi.fn(), resume: vi.fn() };
    const command = vcEventsCapability(runner);
    expect(await command.preview({ 'meeting-id': '1234567890123456', 'page-size': 1 })).toMatchObject({ requests: [{ query: { page_size: '20' } }] });
    await expect(command.preview({ 'meeting-id': '123456789' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(runner.start).not.toHaveBeenCalled();
});

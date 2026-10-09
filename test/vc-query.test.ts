import { describe, expect, it, vi } from 'vitest';
import { vcQueryCapabilities, vcQueryPrograms } from '../src/capabilities/vc/query';
import type { CommandContext } from '../src/ports/capabilities';
import type { ApiRequest } from '../src/ports/lark';
import type { JsonObject } from '../src/domain/models';
const context = (request: CommandContext['lark']['request']): CommandContext => ({ lark: { request }, selection: { profileId: 'p', accountId: 'a', identity: 'user' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], domains: ['vc', 'artifact'], permissions: ['read', 'write'] } });
const runner = { start: vi.fn(async () => ({ workflowId: 'w', selection: { profileId: 'p', identity: 'user' as const }, status: 'pending' as const })), resume: vi.fn() };
async function run(state: JsonObject, replies: JsonObject[]) {
    const request = vi.fn(async (_r: ApiRequest) => replies.shift() ?? {});
    const program = vcQueryPrograms()[0]!;
    for (let i = 0; i < 30; i++) {
        const before = request.mock.calls.length;
        const result = await program.step(state, context(request));
        expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
        if (result.done) return { output: result.output, request };
        state = result.state;
    }
    throw new Error('Workflow did not complete.');
}
describe('VC query shortcuts', () => {
    it('searches meeting filters, preserves pagination and removes avatars', async () => {
        const request = vi.fn(async (_r: ApiRequest) => ({ items: [{ id: '1', meta_data: { avatar: 'a', description: 'd' } }], has_more: true, page_token: 'n' }));
        const command = vcQueryCapabilities(runner).find(c => c.definition.id === 'vc.+search')!;
        const result = await command.execute({ start: '2026-10-01', 'participant-ids': 'ou_a,ou_a', 'room-ids': 'room' }, context(request));
        expect(request.mock.calls[0]![0]).toMatchObject({ body: { meeting_filter: { participant_ids: ['ou_a'], open_room_ids: ['room'], start_time: { start_time: '2026-10-01T00:00:00Z' } } } });
        expect(JSON.stringify(result)).not.toContain('avatar');
        await expect(command.preview({})).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('skips recording for ongoing meetings and consolidates ended meeting metadata', async () => {
        const result = await run({ action: 'detail', args: { 'meeting-ids': 'one,two' }, phase: 'meeting', index: 0, results: [] }, [
            { meeting: { topic: 'Ongoing', start_time: '1700000000', end_time: '0' } },
            { meeting: { topic: 'Ended', start_time: '1700000000', end_time: '1700000100', note_id: 'note' } },
            { recording: { url: 'https://meetings.feishu.cn/minutes/token' } },
        ]);
        expect(result.request).toHaveBeenCalledTimes(3);
        expect(result.output).toMatchObject({ meetings: [{ meeting_id: 'one', hint: expect.stringContaining('progress') }, { meeting_id: 'two', note_id: 'note', minute_token: 'token' }] });
    });
    it('resolves calendar recording candidates and skips absent recordings', async () => {
        const result = await run({ action: 'recording', args: { 'calendar-event-ids': 'event' }, phase: 'calendar', index: 0, results: [] }, [
            { calendars: [{ calendar: { calendar_id: 'calendar' } }] },
            { instance_relation_infos: [{ meeting_instance_ids: ['m1', 'm2'] }] },
            {}, { recording: { url: 'https://meetings.feishu.cn/minutes/t', duration: '9' } },
        ]);
        expect(result.output).toEqual({ recordings: [{ calendar_event_id: 'event', meeting_id: 'm2', recording_url: 'https://meetings.feishu.cn/minutes/t', duration: '9', minute_token: 't' }] });
        expect(result.request.mock.calls[1]![0].body).toEqual({ instance_ids: ['event'], need_meeting_instance_ids: true });
    });
});

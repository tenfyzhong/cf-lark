import { describe, expect, it, vi } from 'vitest';
import { vcCapabilities } from '../src/capabilities/vc/commands';
import type { ApiRequest } from '../src/ports/lark';
import type { CommandContext } from '../src/ports/capabilities';
const meeting = '1234567890123456789';
function setup(reply = {}) {
    const request = vi.fn(async (_request: ApiRequest) => reply);
    const context = { lark: { request }, selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user', 'bot'] }], domains: ['vc', 'minutes', 'artifact'], permissions: ['read', 'write'] } } as CommandContext;
    const get = (name: string) => vcCapabilities().find(c => c.definition.id === `vc.+${name}`)!;
    return { request, context, get };
}
describe('meeting controls', () => {
    it('starts a calendar meeting and keeps ordinary join action absent', async () => {
        const { get, request, context } = setup();
        await get('meeting-join').execute({ 'meeting-number': '123456789', action: 'START', password: ' secret ', 'call-id': 'c' }, context);
        expect(request).toHaveBeenLastCalledWith({ method: 'POST', path: '/open-apis/vc/v1/bots/join', body: { join_type: 1, join_identify: { meeting_no: '123456789' }, action: 2, password: 'secret', call_id: 'c' } });
        await get('meeting-join').execute({ 'meeting-number': '123456789' }, context);
        expect(request.mock.calls.at(-1)![0].body).not.toHaveProperty('action');
    });
    it('normalizes and deduplicates invitees and reports omitted candidates', async () => {
        const { get, request, context } = setup({ has_more: true, invited_count: 1 });
        const output = await get('meeting-invite').execute({ 'meeting-id': meeting, type: 'selected', 'open-ids': ['ou_a', ' ou_a ', 'ou_b'] }, context);
        expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/open-apis/vc/v1/bots/invite', query: { user_id_type: 'open_id' }, body: { meeting_id: meeting, invite_type: 2, invitees: [{ id: 'ou_a', user_type: 1 }, { id: 'ou_b', user_type: 1 }] } });
        expect(output).toMatchObject({ meeting_id: meeting, notice: expect.any(String) });
        expect(output).not.toHaveProperty('has_more');
    });
    it('preserves explicit false countdown audio and validates conditional flags', async () => {
        const { get, request, context } = setup();
        await get('meeting-countdown').execute({ 'meeting-id': meeting, action: 'set', duration: 5, 'need-play-audio-at-end': false, 'reminder-before-end': 1 }, context);
        expect(request.mock.calls[0]![0].body).toEqual({ meeting_id: meeting, action: 'set', duration: 5, need_play_audio_at_end: false, reminder_before_end: 1 });
        await expect(get('meeting-countdown').preview({ 'meeting-id': meeting, action: 'prolong', duration: 5, 'need-play-audio-at-end': false })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('infers message types and rejects ambiguous or oversized payloads before requests', async () => {
        const { get, request, context } = setup();
        await get('meeting-message-send').execute({ 'meeting-id': meeting, 'emoji-type': 'LOVE', uuid: 'key' }, context);
        expect(request.mock.calls[0]![0].body).toEqual({ meeting_id: meeting, msg_type: 'reaction', content: 'LOVE', uuid: 'key' });
        for (const args of [{ text: 'hello', 'emoji-type': 'LOVE' }, { text: 'x'.repeat(49153) }, { text: 'hi', uuid: 'x'.repeat(129) }]) {
            await expect(get('meeting-message-send').preview({ 'meeting-id': meeting, ...args })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        }
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('enforces long numeric IDs and identity-sensitive active lookup', async () => {
        const { get, request, context } = setup({ meetings: [] });
        await expect(get('meeting-end').preview({ 'meeting-id': '123456789' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(get('meeting-list-active').execute({}, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await get('meeting-list-active').execute({ 'user-id': 'ou_a' }, context);
        expect(request.mock.calls[0]![0].query).toEqual({ user_id: 'ou_a' });
        await get('meeting-list-active').execute({ 'user-id': 'ignored' }, { ...context, selection: { profileId: 'p', identity: 'user' } });
        expect(request.mock.calls[1]![0].query).toEqual({});
        expect(await get('meeting-end').execute({ 'meeting-id': meeting }, context)).toMatchObject({ meeting_id: meeting });
    });
});

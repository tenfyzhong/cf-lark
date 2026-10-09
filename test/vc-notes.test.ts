import { expect, it, vi } from 'vitest';
import { vcNotesProgram } from '../src/capabilities/vc/notes';
import type { ApiRequest } from '../src/ports/lark';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
import type { ArtifactStore } from '../src/ports/artifacts';
const artifacts = { upload: vi.fn(async () => ({ id: 'private-transcript' })) } as unknown as ArtifactStore;
async function run(args: JsonObject, replies: JsonObject[]) {
    const request = vi.fn(async (_r: ApiRequest) => replies.shift() ?? {});
    const context: CommandContext = { lark: { request }, selection: { profileId: 'p', accountId: 'a', identity: 'user' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], domains: ['vc', 'artifact'], permissions: ['read', 'write'] } };
    let state: JsonObject = { args, phase: args['calendar-event-ids'] ? 'calendar' : args['minute-tokens'] ? 'minute' : 'meeting', index: 0, results: [] };
    for (let i = 0; i < 30; i++) {
        const before = request.mock.calls.length;
        const result = await vcNotesProgram(artifacts).step(state, context);
        expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
        if (result.done) return { result: result.output, request };
        state = result.state;
    }
    throw new Error('Notes did not complete.');
}
it('collects minute note metadata and independent AI artifacts in checkpoints', async () => {
    const { result } = await run({ 'minute-tokens': 'token' }, [{ minute: { title: 'Title', note_id: 'note' } }, { note: { note_id: 'note', note_doc_token: 'doc', note_display_type: 1 } }, { summary: 'Summary', transcript: 'Transcript', minute_todos: [{ content: 'todo' }] }]);
    expect(result).toMatchObject({ notes: [{ minute_token: 'token', title: 'Title', note_id: 'note', artifacts: { summary: 'Summary', transcript_file: 'private-transcript' } }] });
});
it('preserves calendar note tokens when no meeting note exists', async () => {
    const { result, request } = await run({ 'calendar-event-ids': 'event' }, [{ calendars: [{ calendar: { calendar_id: 'cal' } }] }, { instance_relation_infos: [{ meeting_instance_ids: ['m'], meeting_notes: ['doc'] }] }, { meeting: {} }, {}]);
    expect(result).toMatchObject({ notes: [{ calendar_event_id: 'event', meeting_notes: ['doc'] }] });
    expect(request.mock.calls[1]![0].body).toHaveProperty('need_meeting_notes', true);
});

import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactStore } from '../../ports/artifacts';
import type { Capability } from '../../ports/capabilities';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { noteDetailCapability } from '../note/index';
import { invalid, string } from './commands';
import { csv, list, minuteToken, object } from './query';
import { vcNotesDefinition } from './notes-definition';
function mode(args: JsonObject): string {
    const modes = ['meeting-ids', 'minute-tokens', 'calendar-event-ids'].filter(key => csv(args[key]).length);
    if (modes.length !== 1 || csv(args[modes[0]!]).length > 50) invalid('Provide exactly one batch of at most 50 meeting-ids, minute-tokens, or calendar-event-ids.');
    if (modes[0] === 'minute-tokens' && csv(args['minute-tokens']).some(token => !/^[a-z0-9]+$/.test(token))) invalid('Minute tokens must be lowercase alphanumeric.');
    if (string(args, 'output-dir').split(/[\\/]/).includes('..')) invalid('Output names cannot contain traversal.');
    return modes[0]!;
}
export function vcNotesCapability(workflows: WorkflowRunner): Capability {
    return { definition: vcNotesDefinition, preview: async args => ({ program: 'vc-notes', mode: mode(args), args, output: 'Note document tokens, minute artifacts, and private transcript artifact IDs.' }), execute: async (args, context) => {
        const selected = mode(args);
        if (selected === 'minute-tokens') authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
        return workflows.start('vc-notes', { args, phase: selected === 'calendar-event-ids' ? 'calendar' : selected === 'minute-tokens' ? 'minute' : 'meeting', index: 0, results: [] }, context.selection, context.grant);
    } };
}
export function vcNotesProgram(artifacts: ArtifactStore): WorkflowProgram {
    return { id: 'vc-notes', version: 1, domain: 'vc', risk: 'read', identities: ['user', 'bot'], step: async (raw, context) => {
        const state = raw as { args: JsonObject; phase: string; index: number; results: JsonObject[]; calendar?: string; candidates?: string[]; candidate?: number; current?: JsonObject; noteId?: string; relationNotes?: string[] };
        const selected = mode(state.args), ids = csv(state.args[selected]), id = ids[state.index];
        if (!id) return { done: true, output: { notes: state.results, ...(state.results.every(item => !['note_id', 'note_doc_token', 'verbatim_doc_token', 'minute_token', 'meeting_notes', 'shared_doc_tokens', 'artifacts'].some(key => item[key])) ? { partial_failure: true } : {}) } };
        if (selected === 'minute-tokens') authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
        const current = state.current ?? { [selected === 'minute-tokens' ? 'minute_token' : selected === 'calendar-event-ids' ? 'calendar_event_id' : 'meeting_id']: id };
        const finish = () => {
            const docs = new Set([current.note_doc_token, current.verbatim_doc_token, ...list(current.shared_doc_tokens)]);
            const relationNotes = (state.relationNotes ?? []).filter(token => !docs.has(token));
            if (relationNotes.length) current.meeting_notes = relationNotes;
            if (selected === 'calendar-event-ids' && !current.note_id && (state.candidate ?? 0) + 1 < (state.candidates?.length ?? 0)) return { done: false as const, state: { ...state, candidate: (state.candidate ?? 0) + 1, current: { calendar_event_id: id }, phase: 'meeting', noteId: '' } };
            if (selected === 'calendar-event-ids' && !current.note_id && relationNotes.length) { delete current.error; delete current.meeting_id; }
            return { done: false as const, state: { args: state.args, calendar: state.calendar, index: state.index + 1, phase: selected === 'calendar-event-ids' ? 'relation' : selected === 'minute-tokens' ? 'minute' : 'meeting', results: [...state.results, current] } };
        };
        const appendError = (message: string) => { current.error = [current.error, message].filter(Boolean).join('; '); };
        if (state.phase === 'calendar') {
            const data = await context.lark.request({ method: 'POST', path: '/open-apis/calendar/v4/calendars/primary' });
            const calendar = object(object(list(data.calendars)[0]).calendar).calendar_id;
            if (typeof calendar !== 'string' || !calendar) throw new ServiceError('NOT_FOUND', 'Primary calendar not found.', 404);
            return { done: false, state: { ...state, calendar, phase: 'relation' } };
        }
        if (state.phase === 'relation') {
            try {
                const data = await context.lark.request({ method: 'POST', path: `/open-apis/calendar/v4/calendars/${encodeURIComponent(state.calendar!)}/events/mget_instance_relation_info`, body: { instance_ids: [id], need_meeting_instance_ids: true, need_meeting_notes: true } });
                const info = object(list(data.instance_relation_infos)[0]), candidates = list(info.meeting_instance_ids).filter(value => value !== null).map(String), relationNotes = list(info.meeting_notes).filter((value): value is string => typeof value === 'string' && !!value);
                if (!candidates.length) { current.error = 'No associated video meeting for this event.'; return finish(); }
                return { done: false, state: { ...state, candidates, relationNotes, candidate: 0, current, phase: 'meeting' } };
            } catch (error) { if (!(error instanceof ServiceError)) throw error; appendError(error.message); return finish(); }
        }
        const meeting = selected === 'calendar-event-ids' ? state.candidates![state.candidate ?? 0]! : id;
        if (state.phase === 'meeting' || state.phase === 'minute') {
            try {
                const minuteMode = state.phase === 'minute';
                const data = await context.lark.request({ method: 'GET', path: minuteMode ? `/open-apis/minutes/v1/minutes/${id}` : `/open-apis/vc/v1/meetings/${encodeURIComponent(meeting)}`, ...(!minuteMode ? { query: { with_participants: 'false', query_mode: '0' } } : {}) });
                const info = object(data[minuteMode ? 'minute' : 'meeting']);
                if (!data[minuteMode ? 'minute' : 'meeting']) { appendError('Meeting or minute not found.'); return finish(); }
                if (minuteMode && info.title) current.title = info.title;
                if (!minuteMode) current.meeting_id = meeting;
                const noteId = typeof info.note_id === 'string' ? info.note_id : '';
                if (!noteId && !minuteMode) appendError('No notes available for this meeting.');
                return { done: false, state: { ...state, current, noteId, phase: minuteMode ? noteId ? 'note' : 'artifacts' : 'recording' } };
            } catch (error) { if (!(error instanceof ServiceError)) throw error; appendError(error.message); return finish(); }
        }
        if (state.phase === 'recording') {
            try {
                const data = await context.lark.request({ method: 'GET', path: `/open-apis/vc/v1/meetings/${encodeURIComponent(meeting)}/recording` });
                const token = minuteToken(object(data.recording).url);
                if (token) current.minute_token = token; else appendError('No minute_token found for this meeting.');
            } catch (error) { if (!(error instanceof ServiceError)) throw error; appendError(error.message); }
            return state.noteId ? { done: false, state: { ...state, current, phase: 'note' } } : finish();
        }
        if (state.phase === 'note') {
            try { const data = object(await noteDetailCapability().execute({ 'note-id': state.noteId }, context)); Object.assign(current, object(data.note)); }
            catch (error) { if (!(error instanceof ServiceError)) throw error; if (selected !== 'minute-tokens') appendError(error.message); else current.warnings = [error.message]; }
            return selected === 'minute-tokens' ? { done: false, state: { ...state, current, phase: 'artifacts' } } : finish();
        }
        try {
            const data = await context.lark.request({ method: 'GET', path: `/open-apis/minutes/v1/minutes/${id}/artifacts` });
            const output: JsonObject = {};
            if (data.summary) output.summary = data.summary;
            for (const [source, target] of [['minute_todos', 'todos'], ['minute_chapters', 'chapters'], ['keywords', 'keywords']] as const) if (list(data[source]).length) output[target] = data[source];
            if (typeof data.transcript === 'string' && data.transcript) {
                const blob = new Blob([data.transcript], { type: 'text/plain;charset=utf-8' });
                output.transcript_file = (await artifacts.upload(context.grant.id, blob.size, blob.stream())).id;
            }
            if (Object.keys(output).length) current.artifacts = output;
        } catch (error) { if (!(error instanceof ServiceError)) throw error; current.warnings = [...list(current.warnings), error.message]; }
        return finish();
    } };
}

import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { invalid, string } from './commands';
import { vcQueryDefinitions } from './query-definitions';
export const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const csv = (value: unknown): string[] => typeof value === 'string' ? value.split(',').map(item => item.trim()).filter(Boolean) : [];
export function time(value: unknown, end = false): string {
    const raw = String(value ?? '').trim(); if (!raw || raw === '0') return '';
    const day = /^\d{4}-\d{2}-\d{2}$/.test(raw);
    const date = new Date(/^\d+$/.test(raw) ? Number(raw) * (raw.length > 10 ? 1 : 1000) : day ? `${raw}T${end ? '23:59:59' : '00:00:00'}Z` : raw);
    if (!Number.isFinite(date.getTime()) || (day && date.toISOString().slice(0, 10) !== raw)) invalid('Invalid meeting time.');
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
export function minuteToken(url: unknown): string { try { return new URL(String(url)).pathname.match(/\/minutes\/([^/]+)/)?.[1] ?? ''; } catch { return ''; } }
function search(args: JsonObject): ApiRequest {
    const query = string(args, 'query'), size = Number(args['page-size'] ?? 15);
    if ([...query].length > 50 || !Number.isInteger(size) || size < 1 || size > 30) invalid('Query cannot exceed 50 characters and page-size must be 1 to 30.');
    const start = time(args.start), end = time(args.end, true); if (start && end && start > end) invalid('start must not be after end.');
    const filter: JsonObject = {};
    for (const [key, target] of [['organizer-ids', 'organizer_ids'], ['participant-ids', 'participant_ids'], ['room-ids', 'open_room_ids']] as const) {
        let ids = csv(args[key]); if (key === 'participant-ids') ids = [...new Set(ids)]; if (ids.length) filter[target] = ids;
    }
    if (start || end) filter.start_time = { ...(start ? { start_time: start } : {}), ...(end ? { end_time: end } : {}) };
    if (!query && !Object.keys(filter).length) invalid('At least one search filter is required.');
    return { method: 'POST', path: '/open-apis/vc/v1/meetings/search', query: { page_size: String(size), ...(args['page-token'] ? { page_token: string(args, 'page-token') } : {}) }, body: { ...(query ? { query } : {}), ...(Object.keys(filter).length ? { meeting_filter: filter } : {}) } };
}
function validateBatch(args: JsonObject, action: string): void {
    const meetings = csv(args['meeting-ids']), events = csv(args['calendar-event-ids']);
    if (action === 'detail' ? !meetings.length : Boolean(meetings.length) === Boolean(events.length)) invalid('Provide exactly one nonempty meeting-ids or calendar-event-ids list.');
    if (meetings.length > 50 || events.length > 50) invalid('Batch limit is 50 IDs.');
}
export function vcQueryCapabilities(workflows: WorkflowRunner): Capability[] {
    return vcQueryDefinitions.map(definition => {
        const action = definition.id.slice(4);
        return { definition, preview: async args => {
            if (action === 'search') return { requests: [search(args)] };
            validateBatch(args, action);
            return { program: 'vc-query', action, meeting_ids: csv(args['meeting-ids']), calendar_event_ids: csv(args['calendar-event-ids']), steps: ['Resolve calendar relations if requested.', 'Read each meeting and recording in bounded checkpoints.'] };
        }, execute: async (args, context) => {
            if (action === 'search') {
                const data = await context.lark.request(search(args));
                const items = list(data.items).map(item => { const copy = { ...object(item) }, meta = { ...object(object(item).meta_data) }; delete meta.avatar; if (copy.meta_data) copy.meta_data = meta; return copy; });
                return { items, has_more: data.has_more ?? false, page_token: data.page_token ?? '', ...(data.notice ? { notice: data.notice } : {}) };
            }
            validateBatch(args, action);
            return workflows.start('vc-query', { action, args, phase: args['calendar-event-ids'] ? 'calendar' : action === 'detail' ? 'meeting' : 'recording', index: 0, results: [] }, context.selection, context.grant);
        } };
    });
}
export function vcQueryPrograms(): WorkflowProgram[] {
    return [{ id: 'vc-query', version: 1, domain: 'vc', risk: 'read', identities: ['user', 'bot'], step: async (raw, context) => {
        const state = raw as { action: string; args: JsonObject; phase: string; index: number; results: JsonObject[]; calendar?: string; candidates?: string[]; candidate?: number; current?: JsonObject };
        const events = csv(state.args['calendar-event-ids']), ids = events.length ? events : csv(state.args['meeting-ids']), id = ids[state.index];
        if (!id) return { done: true, output: { [state.action === 'detail' ? 'meetings' : 'recordings']: state.results, ...(state.results.every(item => item.error) ? { partial_failure: true } : {}) } };
        const current = state.current ?? { ...(events.length ? { calendar_event_id: id } : { meeting_id: id }), ...(state.action === 'detail' ? { topic: '' } : {}) };
        const next = () => ({ done: false as const, state: { action: state.action, args: state.args, calendar: state.calendar, phase: events.length ? 'relation' : state.action === 'detail' ? 'meeting' : 'recording', index: state.index + 1, results: [...state.results, current] } });
        if (state.phase === 'calendar') {
            const data = await context.lark.request({ method: 'POST', path: '/open-apis/calendar/v4/calendars/primary' });
            const calendar = object(object(list(data.calendars)[0]).calendar).calendar_id;
            if (typeof calendar !== 'string' || !calendar) throw new ServiceError('NOT_FOUND', 'Primary calendar was not found.', 404);
            return { done: false, state: { ...state, calendar, phase: 'relation' } };
        }
        if (state.phase === 'relation') {
            try {
                const data = await context.lark.request({ method: 'POST', path: `/open-apis/calendar/v4/calendars/${encodeURIComponent(state.calendar!)}/events/mget_instance_relation_info`, body: { instance_ids: [id], need_meeting_instance_ids: true } });
                const candidates = list(object(list(data.instance_relation_infos)[0]).meeting_instance_ids).filter(item => item !== null).map(String);
                if (!candidates.length) { current.error = 'No associated video meeting for this event.'; return next(); }
                return { done: false, state: { ...state, candidates, candidate: 0, current, phase: 'recording' } };
            } catch (error) { if (!(error instanceof ServiceError)) throw error; current.error = error.message; return next(); }
        }
        const meeting = events.length ? state.candidates![state.candidate ?? 0]! : id;
        if (state.phase === 'meeting') {
            try {
                const data = await context.lark.request({ method: 'GET', path: `/open-apis/vc/v1/meetings/${encodeURIComponent(meeting)}`, query: { with_participants: 'false', query_mode: '0' } });
                const info = object(data.meeting);
                if (!Object.keys(info).length) { current.error = 'Meeting not found in response.'; return next(); }
                for (const key of ['meeting_no', 'topic', 'note_id']) if (typeof info[key] === 'string' && info[key]) current[key] = info[key];
                const start = time(info.start_time), end = time(info.end_time);
                if (start) current.start_time = start; if (end) current.end_time = end;
                if (start && (!end || end <= start)) { current.hint = 'Meeting is still in progress; note and minute are not generated yet.'; return next(); }
                return { done: false, state: { ...state, current, phase: 'recording' } };
            } catch (error) { if (!(error instanceof ServiceError)) throw error; current.error = error.message; return next(); }
        }
        try {
            const data = await context.lark.request({ method: 'GET', path: `/open-apis/vc/v1/meetings/${encodeURIComponent(meeting)}/recording` });
            const recording = object(data.recording), token = minuteToken(recording.url);
            if (!Object.keys(recording).length) throw new ServiceError('NOT_FOUND', 'No recording available for this meeting.', 404);
            if (state.action === 'recording') {
                current.meeting_id = meeting;
                if (recording.url) current.recording_url = recording.url;
                if (recording.duration) current.duration = recording.duration;
            }
            if (token) current.minute_token = token;
            else if (state.action === 'detail') current.hint = 'No minute_token found in recording URL.';
            if (state.action === 'detail' && !current.note_id) current.hint = ['note_id not found for this meeting', current.hint].filter(Boolean).join('; ');
            return next();
        } catch (error) {
            if (!(error instanceof ServiceError)) throw error;
            if (events.length && (state.candidate ?? 0) + 1 < state.candidates!.length) return { done: false, state: { ...state, candidate: (state.candidate ?? 0) + 1 } };
            const codes: Record<string, string> = { '121004': 'No minute file for this meeting.', '121005': 'No permission to access the minute; ask the meeting owner to share it.', '124002': 'Minute file is still being generated; retry later.' };
            current[state.action === 'detail' ? 'hint' : 'error'] = codes[String(error.details?.upstreamCode)] ?? error.message;
            return next();
        }
    } }];
}

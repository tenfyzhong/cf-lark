import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { arr, base, bounds, calendar, csv, eventId, eventOutput, eventPath, invalid, iso, obj, safe, text } from './helpers';
import { calendarCoreDefinitions } from './core-definitions';
function prepare(action: string, args: JsonObject): ApiRequest {
    if (action === 'join-event') {
        if (args.token && args['share-token'] && args.token !== args['share-token']) invalid('token and share-token aliases conflict.');
        const token = safe(text(args, 'token') || text(args, 'share-token')); if (!token) invalid('Share token is required.');
        return { method: 'POST', path: `${base}/join_event`, body: { share_token: token } };
    }
    if (action === 'search-event') {
        const [start, end] = bounds(args, 'search'), size = Number(args['page-size'] ?? 20);
        if (!Number.isInteger(size) || size < 1 || size > 30) invalid('page-size must be 1 to 30.');
        const filter: JsonObject = {};
        for (const id of csv(args['attendee-ids'])) { const key = id.startsWith('oc_') ? 'attendee_chat_ids' : id.startsWith('omm_') ? 'meeting_room_ids' : 'attendee_user_ids'; (filter[key] ??= [] as string[] as unknown); (filter[key] as string[]).push(id); }
        if (start || end) filter.time_range = { start_time: iso(start), end_time: iso(end) };
        return { method: 'POST', path: `${base}/${encodeURIComponent(calendar(args))}/events/search_event`, query: { page_size: String(size), ...(text(args, 'page-token') ? { page_token: text(args, 'page-token') } : {}) }, body: { query: text(args, 'query'), ...(Object.keys(filter).length ? { filter } : {}) } };
    }
    if (action === 'meeting') {
        const ids = csv(args['event-ids']); if (!ids.length || ids.length > 50) invalid('Provide 1 to 50 event-ids.');
        return { method: 'POST', path: `${base}/${encodeURIComponent(calendar(args))}/events/mget_instance_relation_info`, body: { instance_ids: ids.slice(0, 1), need_meeting_instance_ids: true, need_meeting_notes: true, need_ai_meeting_notes: false } };
    }
    const path = eventPath(args, action === 'get');
    if (action === 'rsvp') {
        const status = text(args, 'rsvp-status'); if (!['accept', 'decline', 'tentative'].includes(status)) invalid('rsvp-status must be accept, decline, or tentative.');
        return { method: 'POST', path: `${path}/reply`, body: { rsvp_status: status } };
    }
    if (action === 'transfer') {
        if (!/^ou_\S+$/.test(text(args, 'to-user-id'))) invalid('to-user-id must be an open_id.');
        return { method: 'POST', path: `${path}/transfer`, query: { user_id_type: 'open_id' }, body: { to_user_id: text(args, 'to-user-id'), need_remove_original_organizer: args['remove-original-organizer'] === true } };
    }
    if (action === 'list-attendees') {
        const size = Number(args['page-size'] ?? 20); if (!Number.isInteger(size) || size < 0) invalid('page-size must be nonnegative.');
        if (csv(args.type).some(type => !['user', 'resource', 'chat', 'third_party'].includes(type))) invalid('Invalid attendee type.');
        return { method: 'GET', path: `${path}/attendees`, query: { page_size: Math.max(10, Math.min(100, size)), ...(text(args, 'page-token') ? { page_token: safe(text(args, 'page-token')) } : {}) } };
    }
    return { method: 'GET', path };
}
function attendee(input: JsonObject): JsonObject {
    const result: JsonObject = {};
    const typed: Record<string, string[]> = { user: ['user_id'], resource: ['room_id', 'resource_customization'], chat: ['chat_id'], third_party: ['third_party_email'] };
    for (const key of ['type', 'display_name', 'operate_id', ...(input.type !== 'chat' ? ['rsvp_status'] : []), ...(typed[String(input.type)] ?? [])]) if (input[key] !== undefined && input[key] !== null && input[key] !== '') result[key] = input[key];
    for (const key of ['is_optional', 'is_organizer']) if (input[key] === true) result[key] = true;
    if (typeof input.is_external === 'boolean') result.is_external = input.is_external;
    return result;
}
export function calendarCoreCapabilities(workflows: WorkflowRunner): Capability[] {
    return calendarCoreDefinitions.map(definition => {
        const action = definition.id.slice(10);
        return { definition, preview: async args => ({ requests: [...(action === 'transfer' && args['transfer-series'] !== true ? [{ method: 'GET', path: eventPath(args) }] : []), prepare(action, args)] }), execute: async (args, context) => {
            const request = prepare(action, args);
            if (action === 'transfer') return workflows.start('calendar-transfer', { action, args, phase: args['transfer-series'] === true ? 'transfer' : 'check' }, context.selection, context.grant);
            if (action === 'meeting') return workflows.start('calendar-meeting', { args, index: 0, results: [] }, context.selection, context.grant);
            const data = await context.lark.request(request);
            if (action === 'join-event') return { joined: true };
            if (action === 'rsvp') return { calendar_id: calendar(args), event_id: eventId(args), rsvp_status: text(args, 'rsvp-status') };
            if (action === 'get') { if (!data.event || typeof data.event !== 'object') throw new ServiceError('INVALID_RESPONSE', 'Calendar response omitted its event.', 502); return eventOutput(obj(data.event), true); }
            if (action === 'list-attendees') { const types = csv(args.type); return { attendees: arr(data.items).filter(item => !types.length || types.includes(String(obj(item).type))).map(item => attendee(obj(item))), has_more: data.has_more === true, page_token: data.page_token ?? '' }; }
            const items = arr(data.items).map(item => {
                const meta = obj(obj(item).meta_data), result: JsonObject = { event_id: meta.event_id ?? '', summary: meta.summary ?? '' };
                if (meta.is_all_day === true) result.is_all_day = true;
                for (const key of ['start', 'end']) { const value = obj(meta[key]); if (value.date || value.date_time) result[key] = Object.fromEntries(['date', 'date_time', 'timezone'].filter(field => value[field]).map(field => [field, value[field]])); }
                return result;
            });
            return { calendar_id: calendar(args), items, has_more: data.has_more === true, page_token: data.page_token ?? '' };
        } };
    });
}
export function calendarCorePrograms(): WorkflowProgram[] {
    return [{ id: 'calendar-transfer', version: 1, domain: 'calendar', risk: 'write', identities: ['user', 'bot'], step: async (raw, context) => {
        const state = raw as { args: JsonObject; phase: string };
        prepare('transfer', state.args);
        if (state.phase === 'check') {
            const data = await context.lark.request({ method: 'GET', path: eventPath(state.args) });
            if (!data.event) throw new ServiceError('INVALID_RESPONSE', 'Calendar response omitted its event.', 502);
            const event = obj(data.event); if (event.recurrence || event.recurring_event_id) invalid('This transfers the entire recurring series. Explicit transfer-series is required.');
            return { done: false, state: { ...state, phase: 'transfer' } };
        }
        await context.lark.request(prepare('transfer', state.args));
        return { done: true, output: { calendar_id: calendar(state.args), event_id: eventId(state.args), new_organizer_id: text(state.args, 'to-user-id'), ...(state.args['remove-original-organizer'] === true || calendar(state.args) === 'primary' ? { original_organizer_removed: state.args['remove-original-organizer'] === true } : {}) } };
    } }, { id: 'calendar-meeting', version: 1, domain: 'calendar', risk: 'read', identities: ['user'], step: async (raw, context) => {
        const state = raw as { args: JsonObject; index: number; results: JsonObject[] }, ids = csv(state.args['event-ids']), id = ids[state.index];
        if (!id) return { done: true, output: { meetings: state.results, ...(state.results.every(item => item.error) ? { partial_failure: true } : {}) } };
        const result: JsonObject = { event_id: id };
        try {
            const data = await context.lark.request(prepare('meeting', { ...state.args, 'event-ids': id }));
            const failure = arr(data.failed_instance_ids).find(value => obj(value).instance_id === id);
            if (failure) result.error = obj(failure).fail_msg === 'No Permission' ? 'No read permission for this calendar event.' : obj(failure).fail_msg === 'Not Found' ? 'Event not found on the specified calendar.' : obj(failure).fail_msg;
            else if (!arr(data.instance_relation_infos).length) result.error = 'No event relation info found.';
            else {
                const info = obj(arr(data.instance_relation_infos)[0]);
                if (arr(info.meeting_instance_ids)[0]) result.meeting_id = arr(info.meeting_instance_ids)[0];
                if (arr(info.meeting_notes)[0]) result.meeting_note = arr(info.meeting_notes)[0];
                const missing = ['meeting_id', 'meeting_note'].filter(key => !result[key]); if (missing.length) result.hint = `${missing.join(', ')} not found for this event`;
            }
        } catch (error) { if (!(error instanceof ServiceError)) throw error; result.error = error.message; }
        return { done: false, state: { ...state, index: state.index + 1, results: [...state.results, result] } };
    } }];
}

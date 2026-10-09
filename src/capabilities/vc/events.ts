import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { invalid, meetingId, string } from './commands';
import { list, object, time } from './query';
import { vcEventsDefinition } from './events-definition';
function request(args: JsonObject): ApiRequest {
    const id = meetingId(args), size = Number(args['page-size'] ?? 20);
    if (!Number.isInteger(size)) invalid('page-size must be an integer.');
    const start = time(args.start), end = time(args.end, true);
    if (start && end && start > end) invalid('start must not be after end.');
    return { method: 'GET', path: '/open-apis/vc/v1/bots/events', query: { meeting_id: id, page_size: String(args['page-all'] ? 100 : Math.max(20, Math.min(100, size))), ...(args['page-token'] ? { page_token: string(args, 'page-token') } : {}), ...(start ? { start_time: String(Date.parse(start) / 1000) } : {}), ...(end ? { end_time: String(Date.parse(end) / 1000) } : {}) } };
}
function label(identity: JsonObject): string {
    const tags = [identity.participant_type, ...(identity.role !== identity.participant_type ? [identity.role] : [])].filter(Boolean);
    return `${identity.name || identity.id || 'unknown'}${tags.length ? ` [${tags.join(',')}]` : ''}`;
}
function actor(value: unknown, self: JsonObject): JsonObject {
    const person = object(value), rawType = String(person.participant_type ?? person.user_type ?? '').toLowerCase(), rawRole = String(person.role ?? person.user_role ?? '').toLowerCase();
    let participant_type = ['1', 'user', 'human', ''].includes(rawType) ? 'human' : ['2', 'bot', 'app', ...(person.participant_type === undefined ? ['10'] : [])].includes(rawType) ? 'bot' : 'unknown';
    const roles: Record<string, string> = person.role !== undefined ? { '1': 'host', '2': 'co_host', '3': 'participant', '4': 'bot', cohost: 'co_host', attendee: 'participant', app: 'bot' } : { '1': 'participant', '2': 'host', '4': 'bot', '0': '', attendee: 'participant', app: 'bot' };
    let role = roles[rawRole] ?? rawRole;
    if (person.id && person.id === self.id && self.participant_type === 'bot') { if (participant_type === 'human') participant_type = 'bot'; if (!role || role === 'participant') role = 'bot'; }
    const identity: JsonObject = { ...(person.id ? { id: person.id } : {}), ...(person.user_name ? { name: person.user_name } : {}), participant_type, role: role || 'participant' };
    identity.label = label(identity); return identity;
}
export function meetingEventsOutput(events: unknown[], data: JsonObject, identity: JsonObject, warnings: string[]): JsonObject {
    let meeting: JsonObject = { status: 'unknown' };
    let endSignal = '';
    const transformed = events.filter(item => item && typeof item === 'object').map(raw => {
        const event = object(raw), payload = { ...object(event.payload) };
        for (const key of Object.keys(payload)) if (Array.isArray(payload[key]) && !payload[key].length) delete payload[key];
        const source = object(payload.meeting);
        if (Object.keys(source).length) {
            const start = time(source.start_time), end = time(source.end_time);
            meeting = { ...(source.id ? { id: source.id } : {}), ...(source.topic ? { topic: source.topic } : {}), ...(source.meeting_no ? { meeting_no: source.meeting_no } : {}), ...(start ? { start_time: start } : {}), ...(end && (!start || end > start) ? { end_time: end } : {}), status: start ? end && end > start ? 'ended' : 'ongoing' : 'unknown' };
        }
        const type = String(event.event_type || payload.activity_event_type || ''), at = time(event.event_time);
        if (type === 'participant_left') for (const item of list(payload.participant_left_items)) {
            const left = object(item);
            if (Number(left.leave_reason) === 2) { const ended = time(left.leave_time) || at; endSignal = ended > endSignal ? ended : endSignal || 'ended'; }
        }
        const fields: Record<string, [string, string]> = { participant_joined: ['participant_joined_items', 'participant'], participant_left: ['participant_left_items', 'participant'], transcript_received: ['transcript_received_items', 'speaker'], chat_received: ['chat_received_items', 'operator'], magic_share_started: ['magic_share_started_items', 'operator'], magic_share_ended: ['magic_share_ended_items', 'operator'], document_context_changed: ['document_context_changed_items', 'operator'], countdown_changed: ['countdown_items', 'operator'] };
        const keys = fields[type], actors = keys ? list(payload[keys[0]]).map(item => object(item)[keys[1]]).filter(Boolean).map(person => actor(person, identity)) : [];
        return { ...(event.event_id ? { event_id: event.event_id } : {}), ...(type ? { event_type: type } : {}), ...(at ? { event_time: at } : {}), ...(actors.length ? { actors } : {}), ...(Object.keys(payload).length ? { payload } : {}) };
    });
    if (endSignal) { meeting.status = 'ended'; if (endSignal !== 'ended') meeting.end_time = endSignal; }
    return { meeting, identity, events: transformed, ...(warnings.length ? { warnings } : {}), has_more: data.has_more === true, ...(data.page_token ? { page_token: data.page_token } : {}) };
}
export function vcEventsCapability(workflows: WorkflowRunner): Capability {
    return { definition: vcEventsDefinition, preview: async args => ({ requests: [request(args)], program: 'vc-meeting-events' }), execute: async (args, context) => {
        request(args); return workflows.start('vc-meeting-events', { args, phase: 'events', events: [], pages: 0 }, context.selection, context.grant);
    } };
}
export function vcEventsProgram(): WorkflowProgram {
    return { id: 'vc-meeting-events', version: 1, domain: 'vc', risk: 'read', identities: ['user', 'bot'], step: async (raw, context) => {
        const state = raw as { args: JsonObject; phase: string; events: unknown[]; pages: number; data?: JsonObject; seen?: string[] };
        if (state.phase === 'events') {
            const data = await context.lark.request(request(state.args)), events = [...state.events, ...list(data.events)], token = typeof data.page_token === 'string' ? data.page_token : '', pages = state.pages + 1;
            const more = state.args['page-all'] === true && data.has_more === true && !!token && pages < 200;
            if (more && (state.seen ?? []).includes(token)) throw new ServiceError('INVALID_RESPONSE', 'Meeting events pagination repeated its cursor.', 502);
            return { done: false, state: { ...state, events, pages, data, phase: more ? 'events' : 'identity', args: { ...state.args, ...(more ? { 'page-token': token } : {}) }, seen: [...(state.seen ?? []), token] } };
        }
        const identity: JsonObject = { participant_type: context.selection.identity === 'bot' ? 'bot' : 'human' }, warnings: string[] = [];
        try {
            const response = await context.lark.request({ method: 'GET', path: context.selection.identity === 'bot' ? '/open-apis/bot/v3/info/' : '/open-apis/authen/v1/user_info' });
            const user = context.selection.identity === 'bot' ? object(response.bot) : response;
            if (user.open_id) identity.id = user.open_id;
            if (user.name || user.app_name) identity.name = user.name || user.app_name;
            if (!identity.id) warnings.push('Current identity open_id is unavailable.');
        } catch (error) { if (!(error instanceof ServiceError)) throw error; warnings.push(`Identity unavailable: ${error.message}`); }
        identity.label = label(identity);
        return { done: true, output: meetingEventsOutput(state.events, state.data ?? {}, identity, warnings) };
    } };
}

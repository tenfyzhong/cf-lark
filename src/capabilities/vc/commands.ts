import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { vcDefinitions } from './definitions';
const base = '/open-apis/vc/v1/bots/';
export function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
export function string(args: JsonObject, key: string): string { return typeof args[key] === 'string' ? args[key].trim() : ''; }
export function meetingId(args: JsonObject): string {
    const value = string(args, 'meeting-id');
    if (!/^\+?\d+$/.test(value) || /^\d{9}$/.test(value) || BigInt(value) <= 0 || BigInt(value) > 9223372036854775807n) invalid('meeting-id must be a positive 64-bit meeting ID, not a nine-digit meeting number.');
    return value;
}
function prepare(action: string, args: JsonObject, context?: Pick<CommandContext, 'selection'>): ApiRequest {
    if (action === 'meeting-list-active') {
        const query: JsonObject = {};
        if (context?.selection.identity === 'bot') {
            const id = string(args, 'user-id');
            if (!/^ou_\S+$/.test(id)) invalid('Bot active meeting lookup requires user-id as an open_id.');
            query.user_id = id;
        }
        return { method: 'GET', path: `${base}user_active_meeting`, query };
    }
    if (action === 'meeting-join') {
        const number = string(args, 'meeting-number'), operation = string(args, 'action').toLowerCase() || 'join';
        if (!/^\d{9}$/.test(number) || !['join', 'start'].includes(operation)) invalid('Provide a nine-digit meeting-number and join or start action.');
        return { method: 'POST', path: `${base}join`, body: { join_type: 1, join_identify: { meeting_no: number }, ...(operation === 'start' ? { action: 2 } : {}), ...(string(args, 'password') ? { password: string(args, 'password') } : {}), ...(string(args, 'call-id') ? { call_id: string(args, 'call-id') } : {}) } };
    }
    const id = action === 'meeting-leave' ? string(args, 'meeting-id') : meetingId(args);
    if (!id) invalid('meeting-id is required.');
    const body: JsonObject = { meeting_id: id };
    let path = action.slice(8);
    let query: JsonObject | undefined;
    if (action === 'meeting-invite') {
        const type = string(args, 'type').toUpperCase();
        const users = [...new Set((Array.isArray(args['open-ids']) ? args['open-ids'] : []).map(value => String(value).trim()).filter(Boolean))];
        if (!['SELECTED', 'ALL_SUGGESTED'].includes(type) || (type === 'SELECTED' && (!users.length || users.length > 200)) || (type === 'ALL_SUGGESTED' && users.length)) invalid('SELECTED requires 1 to 200 open-ids; ALL_SUGGESTED must omit open-ids.');
        body.invite_type = type === 'SELECTED' ? 2 : 1;
        if (type === 'SELECTED') body.invitees = users.map(user => ({ id: user, user_type: 1 }));
        query = { user_id_type: 'open_id' };
    }
    if (action === 'meeting-countdown') {
        const operation = string(args, 'action').toLowerCase();
        if (!['set', 'prolong', 'end_in_advance', 'close_window'].includes(operation)) invalid('Invalid countdown action.');
        body.action = operation;
        const timed = operation === 'set' || operation === 'prolong';
        if (timed ? !Number.isInteger(args.duration) || Number(args.duration) <= 0 : Object.hasOwn(args, 'duration')) invalid('Positive duration is required only for set or prolong.');
        if (timed) body.duration = args.duration;
        for (const key of ['need-play-audio-at-end', 'reminder-before-end']) {
            if (!Object.hasOwn(args, key)) continue;
            if (operation !== 'set') invalid(`${key} is only supported for set.`);
            if (key === 'reminder-before-end' && (!Number.isInteger(args[key]) || Number(args[key]) <= 0 || Number(args[key]) >= Number(args.duration))) invalid('Reminder must be positive and less than duration.');
            body[key.replaceAll('-', '_')] = args[key];
        }
    }
    if (action === 'meeting-message-send') {
        path = 'message';
        const text = string(args, 'text'), emoji = string(args, 'emoji-type'), uuid = string(args, 'uuid');
        const type = string(args, 'msg-type').toLowerCase() || (text && !emoji ? 'text' : emoji && !text ? 'reaction' : '');
        if (type === 'text' ? !text || !!emoji : type === 'reaction' ? !emoji || !!text : true) invalid('Provide exactly one text or emoji-type matching msg-type.');
        if (new TextEncoder().encode(text).length > 48 * 1024 || new TextEncoder().encode(uuid).length > 128) invalid('Message text or idempotency key is too long.');
        body.msg_type = type; body.content = type === 'text' ? text : emoji;
        if (uuid) body.uuid = uuid;
    }
    return { method: 'POST', path: `${base}${path}`, body, ...(query ? { query } : {}) };
}
export function vcCapabilities(): Capability[] {
    return vcDefinitions.map(definition => {
        const action = definition.id.slice(4);
        return { definition, preview: async (args, context) => ({ requests: [prepare(action, args, context)] }), execute: async (args, context) => {
            const data = await context.lark.request(prepare(action, args, context));
            if (action === 'meeting-end') return { ...data, meeting_id: string(args, 'meeting-id') };
            if (action === 'meeting-invite') {
                const { has_more, ...output } = data;
                return { ...output, meeting_id: string(args, 'meeting-id'), ...(has_more === true ? { notice: 'Some eligible candidates were not invited because the service limit is 200.' } : {}) };
            }
            return data;
        } };
    });
}

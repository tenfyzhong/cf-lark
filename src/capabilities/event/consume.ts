import { RE2JS } from 're2js';
import { publicEventPayload } from '../../domain/event-payload';
import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactStore } from '../../ports/artifacts';
import type { Capability } from '../../ports/capabilities';
import type { EventInbox, InboxEvent } from '../../ports/events';
import { formatEventMessage } from '../im/index';
import { eventSubscribeDefinition } from './definitions';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === 'string' ? value : '';
function directory(value: string): string {
    if (!value || value.split(/[\\/]/).includes('..') || /[\x00-\x1f]/.test(value)) invalid('Output directory must not contain traversal or control characters.');
    return value;
}
function regex(pattern: string): RE2JS { try { return RE2JS.compile(pattern); } catch { invalid('Invalid RE2 regular expression.'); } }
function prepare(args: JsonObject) {
    const cursor = Number(args.cursor ?? 0), limit = Number(args.limit ?? 50);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) invalid('cursor must be nonnegative; limit must be 1 to 100.');
    const types = text(args['event-types']).split(',').map(value => value.trim()).filter(Boolean), pattern = text(args.filter);
    const filter = pattern ? regex(pattern) : undefined;
    const routes = array(args.route).map(value => {
        const route = text(value), equals = route.indexOf('=');
        if (equals < 0 || !route.slice(equals + 1).startsWith('dir:')) invalid('Route format is regex=dir:path.');
        return { filter: regex(route.slice(0, equals)), directory: directory(route.slice(equals + 5)) };
    });
    const output = args['output-dir'] ? directory(text(args['output-dir'])) : '';
    return { cursor, limit, types, filter, routes, output };
}
const cleanEnvelope = publicEventPayload;
export function compactEvent(event: InboxEvent): JsonObject {
    const envelope = cleanEnvelope(event.payload), header = object(envelope.header), payload = object(envelope.event), type = event.type;
    const base: JsonObject = { type, ...(header.event_id || event.id ? { event_id: header.event_id || event.id } : {}), ...(header.create_time ? { timestamp: header.create_time } : {}) };
    const put = (key: string, value: unknown) => { if (value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length)) base[key] = value; };
    const openId = (value: unknown) => text(object(value).open_id);
    if (type === 'im.message.receive_v1') {
        const message = object(payload.message), sender = object(payload.sender);
        if (message.message_type === 'interactive') return envelope;
        put('id', message.message_id); put('message_id', message.message_id);
        for (const key of ['create_time', 'chat_id', 'chat_type', 'message_type', 'root_id', 'thread_id']) put(key, message[key]);
        if (!base.timestamp) put('timestamp', message.create_time);
        if (message.update_time !== message.create_time) put('update_time', message.update_time);
        put('sender_id', openId(sender.sender_id)); put('sender_type', sender.sender_type); put('reply_to', message.parent_id);
        put('content', formatEventMessage(message));
        put('mentions', array(message.mentions).map(value => {
            const mention = object(value), result: JsonObject = {};
            if (mention.key) result.key = mention.key;
            const id = typeof mention.id === 'string' ? mention.id : openId(mention.id);
            if (id) result.id = id; if (mention.name) result.name = mention.name;
            return result;
        }).filter(mention => Object.keys(mention).length));
        return base;
    }
    if (type === 'im.message.message_read_v1') {
        const reader = object(payload.reader); put('reader_id', openId(reader.reader_id)); put('read_time', reader.read_time); put('message_ids', payload.message_id_list); return base;
    }
    if (type === 'im.message.reaction.created_v1' || type === 'im.message.reaction.deleted_v1') {
        base.action = type.includes('deleted') ? 'removed' : 'added';
        put('message_id', payload.message_id); put('emoji_type', object(payload.reaction_type).emoji_type); put('operator_id', openId(payload.user_id)); put('action_time', payload.action_time); return base;
    }
    if (/^im\.chat\.(?:updated|disbanded)_v1$/.test(type) || /^im\.chat\.member\.(?:bot|user)\.(?:added|deleted|withdrawn)_v1$/.test(type)) {
        put('chat_id', payload.chat_id); put('operator_id', openId(payload.operator_id)); base.external = payload.external === true;
        if (type.includes('.member.')) base.action = type.includes('.added') ? 'added' : type.includes('.withdrawn') ? 'withdrawn' : 'removed';
        if (type.includes('.member.user.')) put('user_ids', array(payload.users).map(user => openId(object(user).user_id)).filter(Boolean));
        if (type === 'im.chat.updated_v1') { put('before_change', payload.before_change); put('after_change', payload.after_change); }
        return base;
    }
    return { ...payload, ...base };
}
export function eventSubscribeCapability(inbox: Pick<EventInbox, 'read'>, artifacts: ArtifactStore): Capability {
    return { definition: eventSubscribeDefinition,
        preview: async args => { const value = prepare(args); return { transport: 'verified-callback-inbox', cursor: value.cursor, limit: value.limit, event_types: value.types, filter: text(args.filter), output_directory: value.output, routes: args.route ?? [], continuation: 'Poll again with the returned cursor.' }; },
        execute: async (args, context) => {
            const value = prepare(args);
            if (value.output || value.routes.length) authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
            const page = await inbox.read(context.selection.profileId, value.cursor, value.limit);
            const events: JsonObject[] = [];
            for (const event of page.events) {
                if (value.types.length && !value.types.includes(event.type) || value.filter && !value.filter.matcher(event.type).find()) continue;
                const data = args.compact === true ? compactEvent(event) : cleanEnvelope(event.payload);
                const directories = value.routes.filter(route => route.filter.matcher(event.type).find()).map(route => route.directory);
                if (!directories.length && value.output) directories.push(value.output);
                const saved: JsonObject[] = [];
                for (const dir of directories) {
                    const content = new Blob([JSON.stringify(data, null, args.json ? 2 : undefined) + '\n'], { type: 'application/json' });
                    const artifact = await artifacts.upload(context.grant.id, content.size, content.stream());
                    saved.push({ id: artifact.id, directory: dir, name: `${event.id.replace(/[^A-Za-z0-9_.-]/g, '_')}.json` });
                }
                events.push({ sequence: event.sequence, data, ...(saved.length ? { artifacts: saved } : {}) });
            }
            return { events, cursor: page.cursor, transport: 'verified-callback-inbox', continuation: 'Poll again with this cursor. Stop polling to stop consuming.' };
        },
    };
}

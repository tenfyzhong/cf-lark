import { prepareCards, type ImCardFormatter } from './card';
import type { ArtifactFiles } from '../../ports/artifacts';
import { resourceCapability } from './resources';
import { attachResourceRefs, applyResourceResult, conciseMarkdown } from './read-resources';
import { expansionTasks, expandMessage, applyExpansion } from './expansion';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { formatApiMessage, resolveSenderNames } from './format';
import { readDefinitions } from './read-definitions';
const invalid = (message: string): never => { throw new ServiceError('INVALID_ARGUMENTS', message); };
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const objects = (value: unknown): JsonObject[] => Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
const csv = (value: unknown): string[] => String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
const alias = (args: JsonObject, names: string[], fallback?: unknown): unknown => { const present = names.filter((key) => args[key] !== undefined); if (present.length > 1) invalid(`Use only one of ${names.join(', ')}.`); return present.length ? args[present[0]!] : fallback; };
function parseTime(value: unknown, end = false): string {
    const input = String(value).trim();
    if (/^[1-9]\d*$/u.test(input) && BigInt(input) <= 9223372036854775807n) return input;
    if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u.test(input)) return invalid('Time must be ISO 8601 or positive Unix seconds.');
    const calendar = new Date(input.slice(0, 10) + 'T00:00:00Z');
    if (!Number.isFinite(calendar.valueOf()) || calendar.toISOString().slice(0, 10) !== input.slice(0, 10)) return invalid('Invalid calendar date.');
    const day = input.length === 10;
    const zoned = /(?:Z|[+-]\d{2}:\d{2})$/u.test(input);
    const precise = day ? input + (end ? 'T23:59:59Z' : 'T00:00:00Z') : zoned ? input : input.replace(' ', 'T') + 'Z';
    const milliseconds = Date.parse(precise);
    if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== input.slice(0, 10) && !zoned) return invalid('Invalid calendar date.');
    return String(Math.floor(milliseconds / 1000));
}
function validate(name: string, args: JsonObject, identity = 'user'): JsonObject {
    const normalized = { ...args, 'page-size': alias(args, ['page-size', 'limit'], name === 'messages-search' ? 20 : 50), order: alias(args, ['order', 'sort', 'sort-order'], name === 'threads-messages-list' ? 'asc' : 'desc'), start: alias(args, ['start', 'start-time']), end: alias(args, ['end', 'end-time']) };
    const size = Number(normalized['page-size']);
    if (!Number.isInteger(size) || size < 1 || size > 50) invalid('page-size must be between one and fifty.');
    if (!['asc', 'desc'].includes(String(normalized.order))) invalid('order must be asc or desc.');
    for (const flag of ['page-delay', 'page-limit']) if (args[flag] !== undefined && (!Number.isInteger(args[flag]) || Number(args[flag]) < 0)) invalid(`${flag} must be nonnegative.`);
    if (name === 'messages-search' && args['page-limit'] !== undefined && (Number(args['page-limit']) < 1 || Number(args['page-limit']) > 40)) invalid('Search page-limit must be between one and forty.');
    if (name === 'messages-mget') {
        const ids = csv(alias(args, ['message-ids', 'message-id']));
        if (!ids.length || ids.length > 50 || ids.some((id) => !id.startsWith('om_'))) invalid('Provide one to fifty om_ message IDs.');
        return { ...normalized, ids };
    }
    if (name === 'chat-messages-list') {
        if (Boolean(args['chat-id']) === Boolean(args['user-id'])) invalid('Provide exactly one chat-id or user-id.');
        if (args['user-id'] && (identity === 'bot' || !String(args['user-id']).startsWith('ou_'))) invalid('user-id requires user identity and an open ID.');
        if (args['chat-id'] && !String(args['chat-id']).startsWith('oc_')) invalid('chat-id must start with oc_.');
    }
    if (name === 'threads-messages-list') {
        const thread = String(alias(args, ['thread', 'thread-id']) ?? '');
        if (!/^(om_|omt_)/u.test(thread)) invalid('thread must start with om_ or omt_.');
        return { ...normalized, thread };
    }
    for (const key of ['start', 'end']) if (normalized[key as 'start' | 'end']) parseTime(normalized[key as 'start' | 'end'], key === 'end');
    if (name === 'messages-search') {
        if (args['sender-type'] && args['sender-type'] === args['exclude-sender-type']) invalid('Included and excluded sender types must differ.');
        if (normalized.start && normalized.end && BigInt(parseTime(normalized.start)) > BigInt(parseTime(normalized.end, true))) invalid('start cannot be later than end.');
        for (const [key, prefix] of [['chat-id', 'oc_'], ['sender', 'ou_'], ['at-chatter-ids', 'ou_']]) if (csv(args[key!]).some((id) => !id.startsWith(prefix!))) invalid(`Invalid ${key}.`);
        return { ...normalized, query: alias(args, ['query', 'keyword'], '') };
    }
    return normalized;
}
function requestFor(name: string, args: JsonObject, container: unknown, token?: unknown): ApiRequest {
    if (name === 'messages-mget') return mget(args.ids as string[]);
    const query: JsonObject = { page_size: args['page-size'], ...(token ? { page_token: token } : {}) };
    if (name === 'messages-search') {
        const filter: JsonObject = {};
        for (const [flag, wire] of [['chat-id', 'chat_ids'], ['sender', 'from_ids'], ['at-chatter-ids', 'at_chatter_ids']]) { const values = csv(args[flag!]); if (values.length) filter[wire!] = values; }
        for (const [flag, wire, allowed] of [['include-attachment-type', 'include_attachment_types', ['file', 'image', 'video', 'link']], ['sender-type', 'from_types', ['user', 'bot']], ['exclude-sender-type', 'exclude_from_types', ['user', 'bot']]] as const) if (args[flag]) { if (!(allowed as readonly string[]).includes(String(args[flag]))) invalid(`Invalid ${flag}.`); filter[wire] = [args[flag]]; }
        if (args['chat-type']) { if (!['group', 'p2p'].includes(String(args['chat-type']))) invalid('Invalid chat-type.'); filter.chat_type = args['chat-type']; }
        if (args['is-at-me']) filter.is_at_me = true;
        if (args.start || args.end) filter.time_range = { ...(args.start ? { start_time: args.start } : {}), ...(args.end ? { end_time: args.end } : {}) };
        return { method: 'POST', path: '/open-apis/im/v1/messages/search', query, body: { query: args.query, ...(Object.keys(filter).length ? { filter } : {}) } };
    }
    Object.assign(query, { container_id_type: name === 'threads-messages-list' ? 'thread' : 'chat', container_id: container, sort_type: args.order === 'desc' ? 'ByCreateTimeDesc' : 'ByCreateTimeAsc', with_sender_name: true, card_msg_content_type: 'raw_card_content' });
    for (const flag of ['start', 'end']) if (args[flag]) query[`${flag}_time`] = parseTime(args[flag], flag === 'end');
    return { method: 'GET', path: '/open-apis/im/v1/messages', query };
}
const mget = (ids: string[]): ApiRequest => ({ method: 'GET', path: '/open-apis/im/v1/messages/mget', query: { message_ids: ids, with_sender_name: true, card_msg_content_type: 'raw_card_content' }, queryEncoding: { message_ids: 'repeat' } });
export function readCapabilities(workflows: WorkflowRunner): Capability[] {
    return readDefinitions.map((definition) => { const name = definition.id.slice(4); return { definition, preview: async (args, context) => { const valid = validate(name, args, context?.selection.identity); return { request: requestFor(name, valid, valid['chat-id'] ?? valid.thread ?? '<resolved target>', valid['page-token']) }; }, execute: async (args, context) => {
        const valid = validate(name, args, context.selection.identity);
        requestFor(name, valid, valid['chat-id'] ?? valid.thread ?? '<resolved target>', valid['page-token']);
        return workflows.start('im-message-read', { name, args: valid, phase: name === 'chat-messages-list' && valid['user-id'] ? 'p2p' : name === 'threads-messages-list' && String(valid.thread).startsWith('om_') ? 'thread' : 'read', container: valid['chat-id'] ?? valid.thread ?? '', pages: 0, raw: [] }, context.selection, context.grant);
    } }; });
}
export function createReadProgram(artifacts?: ArtifactFiles, cardFormatter?: ImCardFormatter): WorkflowProgram { return { id: 'im-message-read', version: 1, domain: 'im', risk: 'read', identities: ['user', 'bot'], step: async (state, context) => {
    if (Number(state.notBefore ?? 0) > Date.now()) return { done: false, state };
    const name = String(state.name), args = state.args as JsonObject;
    if (state.phase === 'p2p' || state.phase === 'thread') {
        const p2p = state.phase === 'p2p';
        const data = await context.lark.request(p2p ? { method: 'POST', path: '/open-apis/im/v1/chat_p2p/batch_query', query: { chatter_id_type: 'open_id' }, body: { chatter_ids: [args['user-id']] } } : { method: 'GET', path: `/open-apis/im/v1/messages/${encodeURIComponent(String(args.thread))}` });
        const container = objects(p2p ? data.p2p_chats : data.items).map((item) => item[p2p ? 'chat_id' : 'thread_id']).find(Boolean);
        if (!container) throw new ServiceError('NOT_FOUND', 'Conversation target was not found.', 404);
        return { done: false, state: { ...state, container, phase: 'read' } };
    }
    if (state.phase === 'read') {
        const token = state.token ?? args['page-token'] ?? '';
        const data = await context.lark.request(requestFor(name, args, state.container, token));
        const raw = [...objects(state.raw), ...objects(data.items)], pages = Number(state.pages) + 1;
        const pageToken = data.page_token || data.next_page_token || '', hasMore = Boolean(data.has_more), limit = Number(args['page-limit'] ?? (name === 'messages-search' ? args['page-all'] ? 40 : 20 : 10));
        const next = { ...state, raw, pages, token: pageToken, has_more: hasMore, notice: state.notice || data.notice || '' };
        if (name !== 'messages-mget' && (args['page-all'] || name === 'messages-search' && args['page-limit'] !== undefined) && hasMore && pageToken && pageToken !== token && (!limit || pages < limit)) return { done: false, state: { ...next, notBefore: Date.now() + Number(args['page-delay'] ?? 0) } };
        if (name === 'messages-search') return { done: false, state: { ...next, phase: 'mget', ids: raw.map((item) => object(item.meta_data).message_id).filter(Boolean), raw: [], offset: 0 } };
        return { done: false, state: { ...next, phase: 'format' } };
    }
    if (state.phase === 'mget') {
        const ids = state.ids as string[], offset = Number(state.offset);
        if (offset >= ids.length) return { done: false, state: { ...state, phase: 'format' } };
        try { const data = await context.lark.request(mget(ids.slice(offset, offset + 50))); return { done: false, state: { ...state, offset: offset + 50, raw: [...objects(state.raw), ...objects(data.items)] } }; }
        catch { return { done: true, output: { message_ids: ids, total: ids.length, has_more: state.has_more, page_token: state.token, note: 'failed to fetch message details, returning ID list only', ...(state.notice ? { notice: state.notice } : {}) } }; }
    }
    if (state.phase === 'format') {
        const nameCache = object(state.nameCache);
        const messages = (await prepareCards(resolveSenderNames(objects(state.raw), nameCache), cardFormatter)).map((raw) => formatApiMessage(raw, context.lark.brand));
        return { done: false, state: { ...state, nameCache, messages, phase: name === 'messages-search' ? 'chats' : name === 'threads-messages-list' ? 'expand' : 'threads', ids: [...new Set(messages.map((item) => item.chat_id).filter(Boolean))], offset: 0 } };
    }
    const messages = objects(state.messages);
    if (state.phase === 'threads') {
        const seen = new Set<string>(), plans: { index: number; thread: string }[] = [];
        for (const [index, message] of messages.entries()) if (message.thread_id && !seen.has(String(message.thread_id))) { const thread = String(message.thread_id); seen.add(thread); plans.push({ index, thread }); }
        const offset = Number(state.offset), remaining = Number(state.remaining ?? 500);
        if (offset >= plans.length || remaining <= 0) return { done: false, state: { ...state, phase: 'expand', offset: 0 } };
        const plan = plans[offset]!, host = messages[plan.index]!;
        try {
            const data = await context.lark.request({ method: 'GET', path: '/open-apis/im/v1/messages', query: { container_id_type: 'thread', container_id: plan.thread, sort_type: 'ByCreateTimeAsc', page_size: 50, card_msg_content_type: 'raw_card_content', with_sender_name: true } });
            const nameCache = object(state.nameCache), rawReplies = resolveSenderNames(objects(data.items), nameCache), replies = (await prepareCards(rawReplies.slice(0, remaining), cardFormatter)).map((raw) => formatApiMessage(raw, context.lark.brand));
            if (replies.length) { host.thread_replies = replies; if (data.has_more || rawReplies.length > remaining) host.thread_has_more = true; }
            return { done: false, state: { ...state, nameCache, messages, offset: offset + 1, remaining: remaining - replies.length, replyRaw: [...objects(state.replyRaw), ...rawReplies.slice(0, remaining)] } };
        } catch { host.thread_replies_error = true; return { done: false, state: { ...state, messages, offset: offset + 1 } }; }
    }
    if (state.phase === 'chats') {
        const ids = state.ids as string[], offset = Number(state.offset);
        if (offset >= ids.length) return { done: false, state: { ...state, phase: 'expand', offset: 0 } };
        try {
            const data = await context.lark.request({ method: 'POST', path: '/open-apis/im/v1/chats/batch_query', query: { user_id_type: 'open_id' }, body: { chat_ids: ids.slice(offset, offset + 50) } });
            for (const chat of objects(data.items)) for (const message of messages) if (message.chat_id === chat.chat_id) { message.chat_type = chat.chat_mode ?? ''; if (chat.chat_mode === 'p2p' && chat.p2p_target_id) message.chat_partner = { open_id: chat.p2p_target_id }; else if (chat.name) message.chat_name = chat.name; }
        } catch { /* Chat enrichment is best effort. */ }
        return { done: false, state: { ...state, messages, offset: offset + 50 } };
    }
    if (state.phase === 'expand') {
        const tasks = expansionTasks([...objects(state.raw), ...objects(state.replyRaw)]), offset = Number(state.expansionOffset ?? 0);
        if (offset >= tasks.length) return { done: false, state: { ...state, phase: 'reactions', offset: 0 } };
        const task = tasks[offset]!;
        let mergedRaw = objects(state.mergedRaw);
        try { const result = await expandMessage(task, context, cardFormatter, object(state.nameCache)); applyExpansion(messages, task, result.content); if (result.raw) mergedRaw = [...mergedRaw, ...result.raw.map((item) => ({ ...item, _container: task.messageID }))]; }
        catch { if (task.kind === 'merge') applyExpansion(messages, task, '[Merged forward: fetch failed]'); }
        return { done: false, state: { ...state, messages, mergedRaw, expansionOffset: offset + 1 } };
    }
    if (state.phase === 'resources') {
        const tasks = state.resourceTasks as JsonObject[], offset = Number(state.resourceOffset);
        if (offset < tasks.length) {
            const task = tasks[offset]!;
            try { const result = await resourceCapability(artifacts).execute({ 'message-id': task.message_id, 'file-key': task.key, type: task.type, output: task.key }, context); applyResourceResult(messages, task, result as JsonObject); }
            catch (error) { if (error instanceof ServiceError && ['FORBIDDEN', 'GRANT_EXPIRED'].includes(error.code)) throw error; applyResourceResult(messages, task, { download_error: true }); }
            return { done: false, state: { ...state, messages, resourceOffset: offset + 1 } };
        }
        return { done: false, state: { ...state, phase: 'complete', offset: Number.MAX_SAFE_INTEGER } };
    }
    const nodes = messages.flatMap((message) => [message, ...objects(message.thread_replies)]);
    const ids = [...new Set(nodes.map((message) => String(message.message_id)).filter(Boolean))], offset = Number(state.offset);
    if (!args['no-reactions'] && offset < ids.length) {
        const batch = ids.slice(offset, offset + 20);
        try {
            const data = await context.lark.request({ method: 'POST', path: '/open-apis/im/v1/messages/reactions/batch_query', body: { queries: batch.map((message_id) => ({ message_id })) } });
            for (const message of nodes) if (batch.includes(String(message.message_id))) {
                const counts = objects(data.success_msg_reaction_counts).filter((item) => item.message_id === message.message_id).flatMap((item) => Array.isArray(item.reaction_count) ? item.reaction_count : []);
                const details = objects(data.success_msg_reaction_details).filter((item) => item.message_id === message.message_id).flatMap((item) => Array.isArray(item.message_reaction_items) ? item.message_reaction_items : []);
                if (counts.length || details.length) message.reactions = { ...(counts.length ? { counts } : {}), ...(details.length ? { details } : {}) };
                if (objects(data.fail_msg_reaction_details).some((item) => item.message_id === message.message_id)) message.reactions_error = true;
            }
        } catch { for (const message of nodes) if (batch.includes(String(message.message_id))) message.reactions_error = true; }
        return { done: false, state: { ...state, messages, offset: offset + 20 } };
    }
    if (args['download-resources'] && state.phase !== 'complete') { const resourceTasks = attachResourceRefs(messages, [...objects(state.raw), ...objects(state.replyRaw)], objects(state.mergedRaw)); return { done: false, state: { ...state, messages, phase: 'resources', resourceTasks, resourceOffset: 0 } }; }
    return { done: true, output: { messages, total: messages.length, ...(name !== 'messages-mget' ? { has_more: state.has_more, page_token: state.token } : {}), ...(name === 'chat-messages-list' ? { chat_id: state.container } : {}), ...(name === 'threads-messages-list' ? { thread_id: state.container } : {}), ...(state.notice ? { notice: state.notice } : {}), ...(args.concise ? { concise_markdown: conciseMarkdown(messages, state.container, state.has_more, state.token) } : {}) } };
} }; }
export const readProgram = createReadProgram();

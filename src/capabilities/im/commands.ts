import type { ImCardFormatter } from './card';
import { readCapabilities, createReadProgram } from './read';
import { resourceCapability } from './resources';
import { writeCapabilities, writePrograms, type MessageDependencies } from './write';
import { chatReadCapabilities, chatReadProgram } from './chats';
import { flagCapabilities, flagPrograms } from './flags';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { imDefinitions } from './definitions';

const invalid = (message: string): never => { throw new ServiceError('INVALID_ARGUMENTS', message); };
const csv = (value: unknown): string[] => String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
const objects = (value: unknown): JsonObject[] => Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
const required = (args: JsonObject, key: string): string => typeof args[key] === 'string' && String(args[key]).trim() ? String(args[key]) : invalid(`${key} is required.`);
const id = (value: string, prefix: string): string => value.startsWith(prefix) ? value : invalid(`Expected an ID beginning with ${prefix}.`);
function prepare(name: string, args: JsonObject, context?: Pick<CommandContext, 'selection'>): ApiRequest {
    if (['messages-read-status', 'message-read-users', 'chat-members-list'].includes(name)) return prepareMembers(name, args);
    if (name.startsWith('chat-')) {
        const nameValue = String(args.name ?? '');
        const description = String(args.description ?? '');
        if ([...nameValue].length > 60 || [...description].length > 100) invalid('Chat name or description exceeds its character limit.');
        const body: JsonObject = { ...(nameValue ? { name: nameValue } : {}), ...(description ? { description } : {}) };
        const query: JsonObject = { user_id_type: 'open_id' };
        if (name === 'chat-update') {
            if (!Object.keys(body).length) invalid('At least one nonempty updated field is required.');
            return { method: 'PUT', path: `/open-apis/im/v1/chats/${encodeURIComponent(id(required(args, 'chat-id'), 'oc_'))}`, query, body };
        }
        const type = args.type ?? 'private';
        const mode = args['chat-mode'] || 'group';
        if (!['private', 'public'].includes(String(type)) || !['group', 'topic'].includes(String(mode))) invalid('Unsupported chat type or mode.');
        if (type === 'public' && [...nameValue].length < 2) invalid('Public chat names require at least two characters.');
        if (args['set-bot-manager']) {
            if (context?.selection.identity !== 'bot') invalid('set-bot-manager requires bot identity.');
            query.set_bot_manager = true;
        }
        for (const [flag, field, prefix, maximum] of [['users', 'user_id_list', 'ou_', 50], ['bots', 'bot_id_list', 'cli_', 5]] as const) {
            const ids = csv(args[flag]);
            if (ids.length > maximum) invalid(`${flag} exceeds its member limit.`);
            if (ids.length) body[field] = ids.map((value) => id(value, prefix));
        }
        if (args.owner) body.owner_id = id(String(args.owner), 'ou_');
        return { method: 'POST', path: '/open-apis/im/v1/chats', query, body: { ...body, chat_type: type, chat_mode: mode } };
    }
    if (name.startsWith('feed-shortcut-')) {
        if (name === 'feed-shortcut-list') return { method: 'GET', path: '/open-apis/im/v2/feed_shortcuts', query: args['page-token'] ? { page_token: args['page-token'] } : {} };
        if (!Array.isArray(args['chat-id'])) invalid('chat-id must be an array of chat IDs.');
        const ids = [...new Set((args['chat-id'] as unknown[]).flatMap(csv))];
        if (!ids.length || ids.length > 10) invalid('Provide between one and ten unique chat IDs.');
        if (args.head && args.tail) invalid('head and tail are mutually exclusive.');
        return { method: 'POST', path: `/open-apis/im/v2/feed_shortcuts${name.endsWith('remove') ? '/remove' : ''}`, body: { shortcuts: ids.map((value) => ({ feed_card_id: id(value, 'oc_'), type: 1 })), ...(name.endsWith('create') ? { is_header: !args.tail } : {}) } };
    }
    const group = name !== 'feed-group-list' ? encodeURIComponent(required(args, 'feed-group-id')) : '';
    if (name === 'feed-group-query-item') {
        const ids = csv(args['feed-id']);
        if (!ids.length) invalid('feed-id is required.');
        return { method: 'POST', path: `/open-apis/im/v1/groups/${group}/batch_query_item`, body: { items: ids.map((feed_id) => ({ feed_id, feed_type: 'chat' })) } };
    }
    const size = Number(args['page-size'] ?? 50);
    const limit = Number(args['page-limit'] ?? 20);
    if (!Number.isInteger(size) || size < 1 || size > 50 || !Number.isInteger(limit) || limit < 1 || limit > 1000) invalid('Invalid page size or page limit.');
    const query: JsonObject = { page_size: String(size) };
    if (!group || args['page-token']) query.page_token = args['page-token'] ?? '';
    for (const flag of ['start-time', 'end-time']) if (args[flag] !== undefined) {
        const value = String(args[flag]);
        if (!/^-?\d+$/u.test(value) || BigInt(value) < -(2n ** 63n) || BigInt(value) > 2n ** 63n - 1n) invalid(`${flag} must be a signed 64-bit decimal millisecond value.`);
        query[flag.replace('-', '_')] = value;
    }
    return { method: 'GET', path: `/open-apis/im/v1/groups${group ? `/${group}/list_item` : ''}`, query };
}
function ledger(data: JsonObject, request: ApiRequest): JsonObject {
    const requested = objects((request.body as JsonObject).shortcuts);
    const failed = objects(data.failed_shortcuts);
    const labels = ['unknown', 'no_permission', 'invalid_item', 'has_pending_delete', 'type_not_support', 'internal_error'];
    for (const item of failed) if (typeof item.reason === 'number') item.reason_label = labels[item.reason] ?? 'unknown';
    const failedIDs = new Set(failed.map((item) => (item.shortcut as JsonObject | undefined)?.feed_card_id));
    const succeeded = requested.filter((item) => !failedIDs.has(item.feed_card_id));
    return { ...data, total: requested.length, success_count: succeeded.length, failure_count: requested.length - succeeded.length, succeeded_shortcuts: succeeded, ...(failed.length ? { ok: false } : {}) };
}
export function imCapabilities(dependencies: MessageDependencies): Capability[] {
    return [...readCapabilities(dependencies.workflows), resourceCapability(dependencies.artifacts), ...writeCapabilities(dependencies), ...chatReadCapabilities(dependencies.workflows), ...flagCapabilities(dependencies.workflows), ...imDefinitions.filter((item) => !['im.+messages-mget', 'im.+chat-messages-list', 'im.+threads-messages-list', 'im.+messages-search', 'im.+messages-resources-download', 'im.+messages-send', 'im.+messages-reply', 'im.+messages-edit'].includes(item.id) && !item.id.startsWith('im.+flag-') && !['im.+chat-list', 'im.+chat-search'].includes(item.id)).map((definition): Capability => {
        const name = definition.id.slice(4);
        return { definition,
            preview: async (args, context) => ({ request: prepare(name, args, context), ...(name.startsWith('feed-') ? { enrichment: name !== 'feed-group-list' && !args['no-detail'], pagination: Boolean(args['page-all']) } : {}) }),
            execute: async (args, context) => {
                const request = prepare(name, args, context);
                if (name.startsWith('feed-') && !/create|remove/u.test(name) && (args['page-all'] || (name !== 'feed-group-list' && !args['no-detail']))) return dependencies.workflows.start('im-feed-read', { name, args, phase: 'read', pages: 0 }, context.selection, context.grant);
                if (['message-read-users', 'chat-members-list'].includes(name) && args['page-all']) return dependencies.workflows.start('im-members-read', { name, args, pages: 0 }, context.selection, context.grant);
                const data = await context.lark.request(request);
                if (['message-read-users', 'chat-members-list'].includes(name)) return mergeMembers(name, args, {}, data);
                if (name === 'chat-update') return { chat_id: args['chat-id'] };
                if (name === 'chat-create') {
                    const output: JsonObject = {};
                    for (const key of ['chat_id', 'name', 'chat_type', 'owner_id', 'external']) if (data[key] !== undefined) output[key] = data[key];
                    if (typeof data.chat_id === 'string' && data.chat_id.startsWith('oc_')) {
                        if (context.lark.brand) output.chat_app_link = `https://applink.${context.lark.brand === 'lark' ? 'larksuite.com' : 'feishu.cn'}/client/chat/open?openChatId=${encodeURIComponent(data.chat_id)}`;
                        try { const link = await context.lark.request({ method: 'POST', path: `/open-apis/im/v1/chats/${encodeURIComponent(data.chat_id)}/link` }); if (link.share_link !== undefined) output.share_link = link.share_link; } catch { /* Creation succeeded; share links are optional. */ }
                    }
                    return output;
                }
                return /feed-shortcut-(create|remove)/u.test(name) ? ledger(data, request) : data;
            },
        };
    })];
}
export function imPrograms(dependencies: Pick<MessageDependencies, 'artifacts' | 'remoteFiles'> & { cardFormatter?: ImCardFormatter } = {}): WorkflowProgram[] {
    return [createReadProgram(dependencies.artifacts, dependencies.cardFormatter), ...writePrograms(dependencies), chatReadProgram, ...flagPrograms, membersProgram, { id: 'im-feed-read', version: 1, domain: 'im', risk: 'read', identities: ['user'], step: async (state, context) => {
        const name = String(state.name);
        const args = state.args as JsonObject;
        if (state.phase === 'read') {
            const request = prepare(name, { ...args, ...(state.token ? { 'page-token': state.token } : {}) });
            const data = await context.lark.request(request);
            const pages = Number(state.pages) + 1;
            const arrays = name === 'feed-group-list' ? ['groups', 'deleted_groups'] : ['items', 'deleted_items'];
            const output: JsonObject = args['page-all'] ? { has_more: Boolean(data.has_more), page_token: data.page_token ?? '' } : data;
            if (args['page-all']) for (const key of arrays) output[key] = [...objects((state.output as JsonObject | undefined)?.[key]), ...objects(data[key])];
            const previous = state.token ?? args['page-token'] ?? '';
            if (args['page-all'] && data.has_more && data.page_token && data.page_token !== previous && pages < Number(args['page-limit'] ?? 20)) return { done: false, state: { ...state, output, pages, token: data.page_token } };
            if (name === 'feed-group-list' || args['no-detail']) return { done: true, output };
            const entries = name === 'feed-shortcut-list' ? objects(output.shortcuts).filter((item) => item.type === 1) : [...objects(output.items), ...objects(output.deleted_items)];
            const ids = [...new Set(entries.map((item) => String(item[name === 'feed-shortcut-list' ? 'feed_card_id' : 'feed_id'] ?? '')).filter(Boolean))];
            return { done: false, state: { ...state, output, phase: 'enrich', ids, offset: 0 } };
        }
        const output = state.output as JsonObject;
        const ids = state.ids as string[];
        const offset = Number(state.offset);
        if (offset >= ids.length) return { done: true, output };
        try {
            const chats = await context.lark.request({ method: 'POST', path: '/open-apis/im/v1/chats/batch_query', query: { user_id_type: 'open_id' }, body: { chat_ids: ids.slice(offset, offset + 50) } });
            const details = new Map(objects(chats.items).map((item) => [item.chat_id, item]));
            for (const item of name === 'feed-shortcut-list' ? objects(output.shortcuts).filter((item) => item.type === 1) : [...objects(output.items), ...objects(output.deleted_items)]) {
                const detail = details.get(item[name === 'feed-shortcut-list' ? 'feed_card_id' : 'feed_id']);
                if (detail) { if (name === 'feed-shortcut-list') item.detail = detail; else if (detail.name) item.chat_name = detail.name; }
            }
        } catch { output._notice = 'Chat detail enrichment could not be completed.'; }
        return { done: false, state: { ...state, output, offset: offset + 50 } };
    } }];
}

function prepareMembers(name: string, args: JsonObject): ApiRequest {
    if (name === 'messages-read-status') {
        if (args['message-ids'] !== undefined && args['message-id'] !== undefined) invalid('Use message-ids or its alias message-id, not both.');
        const ids = csv(args['message-ids'] ?? args['message-id']);
        if (ids.length < 1 || ids.length > 50) invalid('Provide one to fifty message IDs.');
        return { method: 'POST', path: '/open-apis/im/v1/messages/read_status', body: { message_ids: ids.map((value) => id(value, 'om_')) } };
    }
    if (args.limit !== undefined && args['page-size'] !== undefined) invalid('Use page-size or limit, not both.');
    const member = name === 'chat-members-list';
    const size = Number(args['page-size'] ?? args.limit ?? (member && !args['page-all'] ? 20 : 100));
    if (!Number.isInteger(size) || size < 1 || size > 100) invalid('Page size must be between one and one hundred.');
    for (const flag of ['page-limit', 'page-delay']) if (args[flag] !== undefined && (!Number.isInteger(args[flag]) || Number(args[flag]) < 0)) invalid(`${flag} must be nonnegative.`);
    const type = args[member ? 'member-id-type' : 'user-id-type'] ?? 'open_id';
    if (!['open_id', 'union_id', 'user_id'].includes(String(type))) invalid('Unsupported ID type.');
    const query: JsonObject = { [member ? 'member_id_type' : 'user_id_type']: type, page_size: size };
    if (args['page-token']) query.page_token = String(args['page-token']).trim();
    if (args['member-types'] !== undefined) {
        if (!Array.isArray(args['member-types'])) invalid('member-types must be an array.');
        const types = [...new Set((args['member-types'] as unknown[]).flatMap(csv).map((value) => value.toLowerCase()))];
        if (types.some((value) => !['user', 'bot'].includes(value))) invalid('Unsupported member type.');
        if (types.length) query.member_types = types.join(',');
    }
    const target = id(required(args, member ? 'chat-id' : 'message-id').trim(), member ? 'oc_' : 'om_');
    return { method: 'GET', path: `/open-apis/im/v1/${member ? 'chats' : 'messages'}/${encodeURIComponent(target)}/${member ? 'members/list' : 'read_users'}`, query };
}
function mergeMembers(name: string, args: JsonObject, previous: JsonObject, data: JsonObject): JsonObject {
    const output: JsonObject = { has_more: Boolean(data.has_more), page_token: data.page_token ?? data.next_page_token ?? '' };
    if (name === 'chat-members-list') {
        for (const key of ['users', 'bots']) output[key] = [...objects(previous[key]), ...objects(data[key])];
        output.chat_id = String(args['chat-id']).trim();
        output.truncations = Array.isArray(data.truncations) ? data.truncations : [];
        for (const key of ['user_total', 'bot_total']) if (data[key] !== undefined) output[key] = data[key];
    } else {
        output.items = [...objects(previous.items), ...objects(data.items)];
        output.total = (output.items as unknown[]).length;
    }
    return output;
}
const membersProgram: WorkflowProgram = { id: 'im-members-read', version: 1, domain: 'im', risk: 'read', identities: ['user', 'bot'], step: async (state, context) => {
    if (Number(state.notBefore ?? 0) > Date.now()) return { done: false, state };
    const name = String(state.name);
    const args = state.args as JsonObject;
    const data = await context.lark.request(prepareMembers(name, { ...args, ...(state.token ? { 'page-token': state.token } : {}) }));
    const output = mergeMembers(name, args, state.output as JsonObject ?? {}, data);
    const pages = Number(state.pages) + 1;
    const limit = Number(args['page-limit'] ?? 10);
    if (!output.has_more || !output.page_token || output.page_token === (state.token ?? args['page-token'] ?? '') || (limit > 0 && pages >= limit)) return { done: true, output };
    return { done: false, state: { ...state, output, pages, token: output.page_token, notBefore: Date.now() + Number(args['page-delay'] ?? 0) } };
} };

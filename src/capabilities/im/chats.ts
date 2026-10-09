import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { chatReadDefinitions } from './chat-definitions';
const invalid = (message: string): never => { throw new ServiceError('INVALID_ARGUMENTS', message); };
const csv = (value: unknown): string[] => String(value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
const objects = (value: unknown): JsonObject[] => Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
const strippedNotice = { code: 'bot_strip_p2p', message: 'Bot identity cannot list p2p chats; only group chats were requested. Use user identity to include p2p.' };
function prepare(action: string, args: JsonObject, identity = 'user'): { request: ApiRequest; notices?: JsonObject[] } {
    const size = Number(args['page-size'] ?? 20);
    if (!Number.isInteger(size) || size < 1 || size > 100) invalid('page-size must be between one and one hundred.');
    for (const name of ['page-limit', 'page-delay']) if (args[name] !== undefined && (!Number.isInteger(args[name]) || Number(args[name]) < 0)) invalid(`${name} must be nonnegative.`);
    const query: JsonObject = { page_size: size, ...(args['page-token'] ? { page_token: args['page-token'] } : {}) };
    if (action === 'list') {
        const type = args['user-id-type'] ?? 'open_id';
        if (!['open_id', 'union_id', 'user_id'].includes(String(type))) invalid('Unsupported user-id-type.');
        const map: Record<string, string> = { create_time: 'ByCreateTimeAsc', active_time: 'ByActiveTimeDesc' };
        if (args['sort-type'] && !Object.values(map).includes(String(args['sort-type']))) invalid('Unsupported sort-type.');
        const sort = args.sort !== undefined ? map[String(args.sort)] : args['sort-type'] ?? 'ByCreateTimeAsc';
        if (!sort && args.sort !== '') invalid('Unsupported sort.');
        query.sort_type = sort ?? ''; query.user_id_type = type;
        if (args.types !== undefined && !Array.isArray(args.types)) invalid('types must be an array.');
        const types = [...new Set((args.types as unknown[] ?? []).flatMap(csv).map((value) => value.toLowerCase()))];
        if (types.some((value) => !['p2p', 'group'].includes(value))) invalid('Unsupported chat type.');
        const stripped = identity === 'bot' && types.includes('p2p');
        const effective = stripped ? types.filter((value) => value !== 'p2p') : types;
        if (stripped && !effective.length) invalid('Only user identity can list p2p chats.');
        if (effective.length) query.types = effective.join(',');
        return { request: { method: 'GET', path: '/open-apis/im/v1/chats', query }, ...(stripped ? { notices: [strippedNotice] } : {}) };
    }
    if (!args.query && !args['member-ids']) invalid('Provide query or member-ids.');
    const body: JsonObject = {}, filter: JsonObject = {};
    if (args.query) {
        let value = String(args.query);
        if (value.includes('-')) { try { const parsed: unknown = JSON.parse(value); if (typeof parsed === 'string') value = parsed; } catch { /* Unquoted input is expected. */ } value = JSON.stringify(value); }
        body.query = value;
    }
    for (const [flag, allowed] of [['search-types', ['private', 'external', 'public_joined', 'public_not_joined']], ['chat-modes', ['group', 'topic']]] as const) {
        const values = csv(args[flag]);
        if (values.some((value) => !(allowed as readonly string[]).includes(value))) invalid(`Unsupported ${flag}.`);
        if (values.length) filter[flag.replace('-', '_')] = flag === 'chat-modes' ? [...new Set(values.map((value) => value === 'group' ? 'default' : 'thread'))] : values;
    }
    const ids = csv(args['member-ids']);
    if (ids.length > 50 || ids.some((value) => !value.startsWith('ou_'))) invalid('member-ids accepts at most fifty open IDs.');
    if (ids.length) filter.member_ids = ids;
    for (const flag of ['is-manager', 'disable-search-by-user']) if (args[flag]) filter[flag.replaceAll('-', '_')] = true;
    if (Object.keys(filter).length) body.filter = filter;
    const sorts = ['create_time', 'update_time', 'member_count'];
    if (args['sort-by'] && !sorts.map((value) => `${value}_desc`).includes(String(args['sort-by']))) invalid('Unsupported sort-by.');
    const sort = args.sort ?? String(args['sort-by'] ?? '').replace(/_desc$/u, '');
    if (sort && !sorts.includes(String(sort))) invalid('Unsupported sort.');
    if (sort) body.sorter = `${sort}_desc`;
    return { request: { method: 'POST', path: '/open-apis/im/v2/chats/search', query, body } };
}
export function chatReadCapabilities(workflows: WorkflowRunner): Capability[] {
    return chatReadDefinitions.map((definition) => { const action = definition.id.endsWith('list') ? 'list' : 'search'; return { definition, preview: async (args, context) => prepare(action, args, context?.selection.identity), execute: async (args, context) => { prepare(action, args, context.selection.identity); return workflows.start('im-chat-read', { action, args, phase: 'read', pages: 0 }, context.selection, context.grant); } }; });
}
export const chatReadProgram: WorkflowProgram = { id: 'im-chat-read', version: 1, domain: 'im', risk: 'read', identities: ['user', 'bot'], step: async (state, context) => {
    if (Number(state.notBefore ?? 0) > Date.now()) return { done: false, state };
    const args = state.args as JsonObject;
    const action = String(state.action);
    if (state.phase === 'read') {
        const token = state.token ?? args['page-token'] ?? '';
        const prepared = prepare(action, { ...args, 'page-token': token }, context.selection.identity);
        const data = await context.lark.request(prepared.request);
        const previous = state.output as JsonObject | undefined;
        const chats = [...objects(previous?.chats), ...(action === 'search' ? objects(data.items).map((item) => item.meta_data).filter((item): item is JsonObject => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : objects(data.items))];
        if (action === 'list' && context.lark.brand) for (const chat of chats) if (typeof chat.chat_id === 'string' && chat.chat_id.startsWith('oc_')) chat.chat_app_link = `https://applink.${context.lark.brand === 'lark' ? 'larksuite.com' : 'feishu.cn'}/client/chat/open?openChatId=${encodeURIComponent(chat.chat_id)}`;
        const output: JsonObject = { chats, has_more: Boolean(data.has_more), page_token: data.page_token || data.next_page_token || '', ...(action === 'search' ? { total: data.total ?? 0 } : {}), ...(prepared.notices ? { notices: prepared.notices } : {}) };
        if (data.notice || previous?.notice) output.notice = data.notice || previous?.notice;
        const pages = Number(state.pages) + 1, limit = Number(args['page-limit'] ?? 10);
        if (args['page-all'] && output.has_more && output.page_token && output.page_token !== token && (!limit || pages < limit)) return { done: false, state: { ...state, output, token: output.page_token, pages, notBefore: Date.now() + Number(args['page-delay'] ?? 0) } };
        if (!args['exclude-muted']) return { done: true, output };
        const skip = context.selection.identity === 'bot' ? 'Mute filtering is unavailable for bot identity.' : action === 'search' && csv(args['search-types']).join(',') === 'public_not_joined' ? 'Mute filtering does not apply to public nonmember chats.' : '';
        if (skip) { output.filter = { applied: 'exclude_muted', fetched_count: chats.length, returned_count: chats.length, filtered_count: 0, hint: skip }; return { done: true, output }; }
        return { done: false, state: { ...state, output, phase: 'mute', offset: 0, ids: [...new Set(chats.map((item) => String(item.chat_id ?? '')).filter(Boolean))], muted: {}, unknown: [] } };
    }
    const output = state.output as JsonObject, ids = state.ids as string[], offset = Number(state.offset), muted = state.muted as Record<string, boolean>, unknown = state.unknown as string[];
    if (offset < ids.length) {
        const batch = ids.slice(offset, offset + 100);
        const data = await context.lark.request({ method: 'POST', path: '/open-apis/im/v1/chat_user_setting/batch_get_mute_status', body: { chat_ids: batch } });
        for (const item of objects(data.items)) if (item.chat_id) muted[String(item.chat_id)] = Boolean(item.is_muted);
        const invalidIDs = new Set(objects(data.invalid_id_list).map((item) => item.id));
        for (const key of batch) if (invalidIDs.has(key) || !(key in muted)) unknown.push(key);
        return { done: false, state: { ...state, muted, unknown, offset: offset + 100 } };
    }
    const chats = objects(output.chats);
    const filtered = chats.filter((item) => !item.chat_id || unknown.includes(String(item.chat_id)) || !muted[String(item.chat_id)]);
    output.chats = filtered;
    output.filter = { applied: 'exclude_muted', fetched_count: chats.length, returned_count: filtered.length, filtered_count: chats.length - filtered.length, hint: `${chats.length - filtered.length} muted chat(s) filtered.${unknown.length ? ` ${unknown.length} unknown mute state(s) retained.` : ''}${output.has_more ? ' More pages remain.' : ''}` };
    return { done: true, output };
} };

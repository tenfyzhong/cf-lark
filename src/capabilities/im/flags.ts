import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { flagDefinitions } from './flag-definitions';
const invalid = (message: string): never => { throw new ServiceError('INVALID_ARGUMENTS', message); };
const objects = (value: unknown): JsonObject[] => Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
function initial(action: string, args: JsonObject): JsonObject {
    if (action === 'list') {
        const size = Number(args['page-size'] ?? 50), limit = Number(args['page-limit'] ?? 20);
        if (!Number.isInteger(size) || size < 1 || size > 50 || !Number.isInteger(limit) || limit < 1 || limit > 1000) invalid('Invalid bookmark pagination options.');
        return { action, args, phase: 'list', pages: 0 };
    }
    const message = String(args['message-id'] ?? '').trim();
    if (!message.startsWith('om_')) invalid('message-id must be an om_ message ID.');
    const item = args['item-type'];
    const flag = args['flag-type'];
    if (item !== undefined && !['default', 'thread', 'msg_thread'].includes(String(item))) invalid('Unsupported item-type.');
    if (flag !== undefined && !['message', 'feed'].includes(String(flag))) invalid('Unsupported flag-type.');
    if (action === 'create' && item !== undefined && flag === undefined) invalid('Explicit item-type requires flag-type.');
    const effectiveFlag = flag ?? 'message';
    const effectiveItem = item ?? 'default';
    const auto = action === 'create' && flag === 'feed' && item === undefined;
    const double = action === 'cancel' && item === undefined && flag === undefined;
    if (!auto && !double && !((effectiveItem === 'default' && effectiveFlag === 'message') || (['thread', 'msg_thread'].includes(String(effectiveItem)) && effectiveFlag === 'feed'))) invalid('Invalid item-type and flag-type combination.');
    const items = double ? [{ item_id: message, item_type: '0', flag_type: '2' }] : [{ item_id: message, item_type: String(({ default: 0, thread: 4, msg_thread: 11 } as Record<string, number>)[String(effectiveItem)]), flag_type: effectiveFlag === 'feed' ? '1' : '2' }];
    return { action, args, message, items, double, phase: auto || double ? 'message' : 'write', results: [], offset: 0 };
}
export function flagCapabilities(workflows: WorkflowRunner): Capability[] {
    return flagDefinitions.map((definition) => { const action = definition.id.slice('im.+flag-'.length); return { definition, preview: async (args) => { const state = initial(action, args); return { action, items: state.items, inferChatMode: state.phase === 'message', pagination: args['page-all'] ?? false }; }, execute: async (args, context) => workflows.start(action === 'list' ? 'im-flags-read' : 'im-flags-write', initial(action, args), context.selection, context.grant) }; });
}
export const flagPrograms: WorkflowProgram[] = [{ id: 'im-flags-write', version: 1, domain: 'im', risk: 'write', identities: ['user'], step: async (state, context) => {
    const items = state.items as JsonObject[];
    if (state.phase === 'message' || state.phase === 'chat') {
        try {
            if (state.phase === 'message') {
                const data = await context.lark.request({ method: 'GET', path: `/open-apis/im/v1/messages/${encodeURIComponent(String(state.message))}` });
                const chat = objects(data.items)[0]?.chat_id;
                if (!chat) throw new ServiceError('UPSTREAM_ERROR', 'Message chat could not be resolved.');
                return { done: false, state: { ...state, chat, phase: 'chat' } };
            }
            const data = await context.lark.request({ method: 'GET', path: `/open-apis/im/v1/chats/${encodeURIComponent(String(state.chat))}` });
            const feed = { item_id: state.message, item_type: data.chat_mode === 'topic' ? '4' : '11', flag_type: '1' };
            return { done: false, state: { ...state, phase: 'write', items: state.double ? [...items, feed] : [feed] } };
        } catch (error) {
            if (!state.double) throw error;
            return { done: false, state: { ...state, phase: 'write', _notice: 'Feed-layer cancellation skipped because chat mode could not be determined.' } };
        }
    }
    const offset = Number(state.offset);
    const results = state.results as JsonObject[];
    if (offset >= items.length) return { done: true, output: { results, ...(results.some((item) => item.status === 'failed') ? { ok: false } : {}), ...(state._notice ? { _notice: state._notice } : {}) } };
    const item = items[offset]!;
    try {
        const response = await context.lark.request({ method: 'POST', path: `/open-apis/im/v1/flags${state.action === 'cancel' ? '/cancel' : ''}`, body: { flag_items: [item] } });
        if (state.action === 'create') return { done: true, output: response };
        results.push({ item_id: item.item_id, item_type: item.item_type === '0' ? 'default' : item.item_type === '4' ? 'thread' : 'msg_thread', flag_type: item.flag_type === '1' ? 'feed' : 'message', status: 'ok', response });
    } catch (error) {
        if (state.action === 'create') throw error;
        results.push({ item_id: item.item_id, item_type: item.item_type === '0' ? 'default' : item.item_type === '4' ? 'thread' : 'msg_thread', flag_type: item.flag_type === '1' ? 'feed' : 'message', status: 'failed', error: error instanceof ServiceError ? error.message : 'Bookmark cancellation failed.' });
    }
    return { done: false, state: { ...state, results, offset: offset + 1 } };
} }, { id: 'im-flags-read', version: 1, domain: 'im', risk: 'read', identities: ['user'], step: async (state, context) => {
    const args = state.args as JsonObject;
    if (state.phase === 'list') {
        const token = state.token ?? args['page-token'] ?? '';
        const data = await context.lark.request({ method: 'GET', path: '/open-apis/im/v1/flags', query: { page_size: String(args['page-size'] ?? 50), page_token: token } });
        const output: JsonObject = args['page-all'] ? { has_more: Boolean(data.has_more), page_token: data.page_token ?? '' } : data;
        if (args['page-all']) for (const key of ['flag_items', 'delete_flag_items', 'messages']) output[key] = [...objects((state.output as JsonObject | undefined)?.[key]), ...objects(data[key])];
        const pages = Number(state.pages) + 1;
        if (args['page-all'] && data.has_more && data.page_token && data.page_token !== token && pages < Number(args['page-limit'] ?? 20)) return { done: false, state: { ...state, pages, output, token: data.page_token } };
        if (args['enrich-feed-thread'] === false) return { done: true, output };
        const messages = Object.fromEntries(objects(output.messages).map((item) => [String(item.message_id), item]));
        const ids = [...new Set(objects(output.flag_items).filter((item) => String(item.flag_type) === '1' && ['4', '11'].includes(String(item.item_type))).map((item) => String(item.item_id ?? '')).filter((key) => key && !messages[key]))];
        return { done: false, state: { ...state, output, messages, ids, offset: 0, phase: 'enrich' } };
    }
    const output = state.output as JsonObject;
    const messages = state.messages as Record<string, JsonObject>;
    const ids = state.ids as string[];
    const offset = Number(state.offset);
    if (offset < ids.length) {
        try {
            const data = await context.lark.request({ method: 'GET', path: '/open-apis/im/v1/messages/mget', query: { message_ids: ids.slice(offset, offset + 50) }, queryEncoding: { message_ids: 'repeat' } });
            for (const item of objects(data.items)) if (item.message_id) messages[String(item.message_id)] = item;
        } catch { output._notice = 'Bookmark message enrichment failed.'; }
        return { done: false, state: { ...state, output, messages, offset: offset + 50 } };
    }
    for (const item of objects(output.flag_items)) if (String(item.flag_type) === '1' && ['4', '11'].includes(String(item.item_type)) && messages[String(item.item_id)]) item.message = messages[String(item.item_id)];
    return { done: true, output };
} }];

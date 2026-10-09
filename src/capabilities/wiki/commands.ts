import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { nodePreview, nodeStep, normalizeNode } from './nodes';
import { wikiDefinitions } from './definitions';
const base = '/open-apis/wiki/v2/spaces';
const str = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function resource(value: string) { if (value && /[\s/?#\x00-\x1f]/.test(value)) invalid('Resource IDs must be plain tokens.'); return value; }
function normalize(action: string, input: JsonObject, identity = 'user'): JsonObject {
    const args = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
    const definition = wikiDefinitions.find((item) => item.id === `wiki.+${action}`)!;
    for (const key of definition.inputSchema.required as string[]) if (!str(args[key])) invalid(`${key} is required.`);
    if (identity === 'bot' && args['space-id'] === 'my_library') invalid('Bot identity cannot use my_library.');
    if (args['space-id']) resource(str(args['space-id']));
    if (action.endsWith('list')) {
        args['page-size'] ??= 50; args['page-limit'] ??= 10;
        if (!Number.isInteger(args['page-size']) || Number(args['page-size']) < 1 || Number(args['page-size']) > 50) invalid('page-size must be between 1 and 50.');
        if (!Number.isInteger(args['page-limit']) || Number(args['page-limit']) < 0) invalid('page-limit must be nonnegative.');
    }
    if (action === 'node-list') {
        if (args['space-id'] !== 'my_library' && !/^\d+$/.test(str(args['space-id']))) invalid('space-id must be numeric or my_library.');
        let parent = str(args['parent-node-token']);
        if (parent.includes('://')) {
            let url: URL; try { url = new URL(parent); } catch { return invalid('Invalid parent Wiki URL.'); }
            const match = url.pathname.match(/^\/wiki\/([^/]+)\/?$/);
            if (!match) invalid('parent-node-token URL must identify a Wiki node.');
            parent = decodeURIComponent(match[1]!);
        }
        if (parent) args['parent-node-token'] = resource(parent);
    }
    if (action === 'member-add' || action === 'member-remove') {
        if (!['openid', 'userid', 'email', 'unionid', 'openchat', 'opendepartmentid', 'appid'].includes(str(args['member-type']))) invalid('Invalid member-type.');
        if (!['admin', 'member'].includes(str(args['member-role']))) invalid('Invalid member-role.');
        if (identity === 'bot' && action === 'member-add' && args['member-type'] === 'opendepartmentid') invalid('Department members require user identity.');
    }
    return normalizeNode(action, args, identity);
}
function request(action: string, args: JsonObject, space: string, cursor?: string): ApiRequest {
    const path = `${base}/${encodeURIComponent(space)}`;
    if (action === 'space-create') return { method: 'POST', path: base, body: { name: args.name, ...(args.description ? { description: args.description } : {}) } };
    if (action.endsWith('list')) return { method: 'GET', path: action === 'space-list' ? base : `${path}/${action === 'node-list' ? 'nodes' : 'members'}`, query: {
        page_size: args['page-size'], ...(cursor ? { page_token: cursor } : {}), ...(args['parent-node-token'] ? { parent_node_token: args['parent-node-token'] } : {}),
    } };
    const body = { member_type: args['member-type'], member_role: args['member-role'] };
    if (action === 'member-remove') return { method: 'DELETE', path: `${path}/members/${encodeURIComponent(str(args['member-id']))}`, body };
    return { method: 'POST', path: `${path}/members`, body: { member_id: args['member-id'], ...body }, ...(Object.hasOwn(args, 'need-notification') ? { query: { need_notification: args['need-notification'] } } : {}) };
}
function pick(raw: JsonObject, keys: string[]) { return Object.fromEntries(keys.map((key) => [key, raw[key] ?? ''])); }
const spaceKeys = ['space_id', 'name', 'description', 'space_type', 'visibility', 'open_sharing'];
function record(action: string, raw: JsonObject) {
    if (action.startsWith('space-')) return pick(raw, spaceKeys);
    if (action.startsWith('member-')) return { ...pick(raw, ['member_id', 'member_type', 'member_role']), ...(raw.type ? { type: raw.type } : {}) };
    return { ...pick(raw, ['space_id', 'node_token', 'obj_token', 'obj_type', 'node_type', 'title', 'parent_node_token', 'origin_node_token']), has_child: raw.has_child === true };
}
export function wikiPrograms(): WorkflowProgram[] {
    return wikiDefinitions.map((definition) => {
        const action = definition.id.slice('wiki.+'.length);
        return { id: `wiki-${action}`, version: 1, domain: 'wiki', risk: definition.risk, identities: definition.identities,
            async step(state, context) {
                const args = normalize(action, object(state.args), context.selection.identity);
                if (!action.endsWith('list') && !action.startsWith('member-') && action !== 'space-create') return nodeStep(action, { ...state, args }, context);
                let space = str(state.space || args['space-id']);
                if (space === 'my_library') {
                    const response = await context.lark.request({ method: 'GET', path: `${base}/my_library` });
                    space = str(object(response.space).space_id);
                    if (!space || space === 'my_library') throw new ServiceError('INVALID_RESPONSE', 'Personal library response omitted a concrete space ID.');
                    return { done: false, state: { ...state, args, space, phase: 'execute' } };
                }
                const cursor = str(state.cursor ?? args['page-token']);
                const response = await context.lark.request(request(action, args, space, cursor));
                if (action.endsWith('list')) {
                    const key = action === 'space-list' ? 'spaces' : action === 'node-list' ? 'nodes' : 'members';
                    const raw = response[key === 'members' ? 'members' : 'items'];
                    const items = [...(Array.isArray(state.items) ? state.items : []), ...(Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object').map((item) => record(action, object(item))) : [])];
                    const token = str(response.page_token), more = response.has_more === true, page = Number(state.page ?? 0) + 1;
                    const seen = Array.isArray(state.seen) ? state.seen : [];
                    const repeated = Boolean(token) && (token === cursor || seen.includes(token));
                    const auto = args['page-all'] === true && !str(args['page-token']);
                    if (auto && more && token && !repeated && (args['page-limit'] === 0 || page < Number(args['page-limit']))) return { done: false, state: { args, space, items, cursor: token, page, seen: [...seen, token], phase: 'execute' } };
                    return { done: true, output: { [key]: items, has_more: more, page_token: token, ...(key === 'members' ? { space_id: space } : {}), ...(repeated ? { warning: 'Pagination stopped because the server cursor did not advance.' } : {}) } };
                }
                if (action === 'space-create') {
                    if (!response.space || typeof response.space !== 'object') throw new ServiceError('INVALID_RESPONSE', 'Wiki create response omitted space.');
                    return { done: true, output: record(action, object(response.space)) };
                }
                const output: JsonObject = record(action, object(response.member));
                for (const key of ['member_id', 'member_type', 'member_role']) if (!output[key]) output[key] = args[key.replaceAll('_', '-')];
                return { done: true, output: { space_id: space, ...output } };
            },
        };
    });
}
export function wikiCapabilities(workflows: WorkflowRunner): Capability[] {
    return wikiDefinitions.map((definition) => {
        const action = definition.id.slice('wiki.+'.length);
        return { definition,
            async preview(input, context) {
                const args = normalize(action, input, context?.selection.identity);
                if (!action.endsWith('list') && !action.startsWith('member-') && action !== 'space-create') return nodePreview(action, args);
                const space = str(args['space-id']), requests: ApiRequest[] = [];
                if (space === 'my_library') requests.push({ method: 'GET', path: `${base}/my_library` });
                requests.push(request(action, args, space === 'my_library' ? '{resolved_space_id}' : space, str(args['page-token'])));
                return { requests, pagination: args['page-all'] === true && !args['page-token'] ? { pageLimit: args['page-limit'], resumable: true } : undefined };
            },
            async execute(input, context) {
                const args = normalize(action, input, context.selection.identity);
                return workflows.start(`wiki-${action}`, { args, phase: 'start' }, context.selection, context.grant);
            },
        };
    });
}

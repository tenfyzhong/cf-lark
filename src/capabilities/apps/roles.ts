import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest, LarkClient } from '../../ports/lark';
import type { WorkflowProgram } from '../../ports/workflows';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function malformed(message = 'Malformed role response.'): never { throw new ServiceError('INVALID_UPSTREAM_RESPONSE', message, 502); }
function text(args: JsonObject, key: string) { return typeof args[key] === 'string' ? args[key].trim() : ''; }
const groups: Record<string, [string, string]> = { users: ['user', 'ou_'], departments: ['department', 'od-'], chats: ['chat', 'oc_'] };
function safe(value: string, prefix: string) { return value.startsWith(prefix) && value.length > prefix.length && !/[\s\p{Cc}?#%/\\]/u.test(value); }
export function roleRequest(action: string, args: JsonObject, path: string, preview: boolean): ApiRequest {
    if (!safe(text(args, 'app-id'), 'app_')) invalid('app-id must be a valid app_ identifier.');
    if (action === 'match-list') {
        const user = text(args, 'user-id'); if (!safe(user, 'ou_')) invalid('user-id must be an external ou_ ID.');
        return { method: 'POST', path: `${path}/user_role_list`, body: { target_user_id: user } };
    }
    path += '/roles';
    const id = text(args, 'role-id');
    if (action !== 'list' && (action !== 'create' || 'role-id' in args)) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) invalid('role-id must match [A-Za-z0-9_-]{1,64}.');
        if (action !== 'create') path += `/${id}`;
    }
    if (action === 'list') {
        const limit = args['page-size'] ?? 20, raw = text(args, 'page-token'), offset = raw ? Number(raw) : 0;
        if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) invalid('page-size must be 1-100.');
        if (raw && !/^\+?\d+$/.test(raw) || !Number.isSafeInteger(offset) || offset < 0) invalid('page-token must be a non-negative integer offset.');
        const name = text(args, 'name'); if ('name' in args && !name) invalid('name must not be blank when provided.');
        return { method: 'GET', path, query: { limit, offset, ...(name ? { name } : {}) } };
    }
    if (action === 'get') return { method: 'GET', path };
    if (action === 'delete') { confirm(args, preview); return { method: 'DELETE', path }; }
    if (action === 'create' || action === 'update') {
        const name = text(args, 'name');
        if ((action === 'create' || 'name' in args) && !name) invalid('name must not be blank.');
        if (action === 'update' && !('name' in args) && !('description' in args)) invalid('Provide name or description.');
        return { method: action === 'create' ? 'POST' : 'PATCH', path, body: { ...('name' in args ? { name } : {}), ...('description' in args ? { description: text(args, 'description') } : {}), ...(action === 'create' && id ? { role_id: id } : {}) } };
    }
    if (action === 'member-list') {
        const type = text(args, 'member-type'); if (type && !['user', 'department', 'chat'].includes(type)) invalid('Invalid member-type.');
        return { method: 'GET', path: `${path}/member_list`, query: type ? { member_type: type } : {} };
    }
    const body: JsonObject = {};
    if (action === 'member-remove' && args.all === true) {
        if (Object.keys(groups).some((key) => key in args)) invalid('all cannot be combined with explicit members.');
        body.all = true;
    } else {
        let count = 0;
        for (const [key, [, prefix]] of Object.entries(groups)) {
            const ids = text(args, key).split(',').map((value) => value.trim()).filter(Boolean);
            if (ids.some((id) => !safe(id, prefix))) invalid(`${key} contains an invalid external ID.`);
            count += ids.length; if (ids.length) body[key] = ids;
        }
        if (!count || count > 100) invalid('Provide 1-100 atomic member IDs.');
    }
    if (action === 'member-remove') confirm(args, preview);
    return { method: 'POST', path: `${path}/${action.replaceAll('-', '_')}`, body };
}
function confirm(args: JsonObject, preview: boolean) { if (!preview && args.yes !== true) throw new ServiceError('CONFIRMATION_REQUIRED', 'Explicit yes=true is required.'); }
function object(value: unknown): JsonObject { if (!value || typeof value !== 'object' || Array.isArray(value)) malformed(); return value as JsonObject; }
function collection(value: unknown): JsonObject[] {
    if (!Array.isArray(value)) malformed('Role collection is missing.');
    return value.map((item) => { const role = object(item); if (!text(role, 'role_id') || !text(role, 'name')) malformed('Role collection requires role_id and name.'); return role; });
}
export function rolePage(data: JsonObject) {
    const items = collection(data.items), raw = data.total;
    const total = typeof raw === 'string' && /^\d+$/.test(raw) || typeof raw === 'number' ? Number(raw) : NaN;
    if (!Number.isSafeInteger(total) || total < 0 || typeof data.has_more !== 'boolean') malformed('Role pagination requires valid total and has_more.');
    return { items, total, more: data.has_more };
}
function memberIDs(data: JsonObject, key: string): string[] {
    const values = data[key]; if (!Array.isArray(values)) malformed(`Missing role member group ${key}.`);
    return values.map((value) => { if (typeof value !== 'string' || !value.trim().startsWith(groups[key]![1]) || value.trim().length <= groups[key]![1].length) malformed('Invalid member ID in response.'); return value.trim(); });
}
export function roleResult(action: string, args: JsonObject, request: ApiRequest, data: JsonObject): JsonObject {
    if (action === 'list') {
        const page = rolePage(data), query = request.query as JsonObject;
        return { ...data, items: page.items, total: page.total, has_more: page.more, page_token: page.more ? String(Number(query.offset) + Number(query.limit)) : '' };
    }
    if (action === 'match-list') { collection(data.roles); return data; }
    if (action === 'delete') {
        const id = text(args, 'role-id');
        if (!Object.keys(data).length) return { role_id: id, deleted: true };
        if (data.role_id !== id || data.deleted !== true) malformed('Role deletion was not acknowledged for the requested ID.');
        return data;
    }
    if (action.startsWith('member-')) {
        const result = { ...data };
        const selected = action === 'member-list' ? text(args, 'member-type') : '';
        for (const [key, [type]] of Object.entries(groups)) {
            if (selected && type !== selected) { delete result[key]; continue; }
            if (action === 'member-list' && !Object.keys(data).length) result[key] = [];
            else if (action === 'member-list' || key in data) result[key] = memberIDs(data, key);
        }
        return result;
    }
    const role = object(data.role), id = text(role, 'role_id');
    if (!id || text(args, 'role-id') && text(args, 'role-id') !== id) malformed('Response role ID does not match the request.');
    if ((action === 'get' || 'name' in role) && !text(role, 'name')) malformed('Role name is invalid.');
    if ('description' in role && typeof role.description !== 'string') malformed('Role description must be a string.');
    return data;
}
export async function roleExecute(action: string, args: JsonObject, request: ApiRequest, client: LarkClient) {
    let data: JsonObject;
    try { data = await client.request(request); }
    catch (error) {
        if (action !== 'member-list' || text(args, 'member-type') !== 'chat' || !(error instanceof ServiceError) || !([3344040, 400004040].includes(Number(error.details?.upstreamCode)) || error.details?.upstreamCode === 2 && error.details.reason === 'unsupported_member_type')) throw error;
        const { query: _query, ...retry } = request; data = await client.request(retry);
    }
    return roleResult(action, args, request, data);
}
export function roleListProgram(): WorkflowProgram {
    return { id: 'apps-role-list', version: 1, domain: 'apps', risk: 'read', identities: ['user'],
        async step(state, context) {
            const args = state.args as JsonObject, page = Number(state.page ?? 0), seen = state.seen as string[] ?? [];
            if (page >= 1000) malformed('Role listing exceeded 1000 pages.');
            const request = roleRequest('list', args, `/open-apis/spark/v1/apps/${encodeURIComponent(text(args, 'app-id'))}`, false);
            const data = await context.lark.request({ ...request, query: { limit: 100, offset: page * 100, name: text(args, 'name') } });
            const parsed = rolePage(data), scanned = Number(state.scanned ?? 0) + parsed.items.length;
            if (state.total !== undefined && state.total !== parsed.total || scanned > parsed.total || parsed.more && (scanned >= parsed.total || !parsed.items.length) || !parsed.more && scanned !== parsed.total) malformed('Role pagination total or progress changed.');
            const nextSeen = [...seen];
            for (const item of parsed.items) { const id = text(item, 'role_id'); if (nextSeen.includes(id)) malformed('Role pagination repeated an ID.'); nextSeen.push(id); }
            const matches = [...(state.matches as JsonObject[] ?? []), ...parsed.items.filter((item) => item.name === text(args, 'name'))];
            if (parsed.more) return { done: false, state: { args, page: page + 1, seen: nextSeen, scanned, matches, total: parsed.total, first: state.first ?? data } };
            const query = request.query as JsonObject, start = Math.min(Number(query.offset), matches.length), limit = Number(query.limit), more = start + limit < matches.length;
            return { done: true, output: { ...(state.first as JsonObject ?? data), items: matches.slice(start, start + limit), total: matches.length, has_more: more, page_token: more ? String(start + limit) : '' } };
        },
    };
}

import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function required(args: JsonObject, key: string) { const value = typeof args[key] === 'string' ? args[key].trim() : ''; if (!value) invalid(`${key} must not be blank.`); return value; }
export function sessionRequest(name: string, args: JsonObject, path: string): ApiRequest {
    const query: JsonObject = {};
    if (typeof args['page-token'] === 'string' && args['page-token'].trim()) query.page_token = args['page-token'].trim();
    if (name.startsWith('release-')) {
        if (name !== 'release-list' && !required(args, 'app-id').startsWith('app_')) invalid('app-id must start with app_; resolve meta tokens using apps.+get.');
        path += '/releases';
        if (name === 'release-list') return { method: 'GET', path, query: { page_size: args['page-size'] ?? 20, ...query, ...(args.status ? { status: args.status } : {}) } };
        if (name === 'release-get') return { method: 'GET', path: `${path}/${encodeURIComponent(required(args, 'release-id'))}` };
        const body: JsonObject = {};
        if (typeof args.branch === 'string' && args.branch.trim()) body.branch = args.branch.trim();
        if ('apply-reason' in args) {
            const reason = args['apply-reason'];
            if (typeof reason !== 'string' || !reason.trim() || [...reason].length > 1000 || /[\p{Cc}\u200b-\u200d\ufeff\u2028-\u202e\u2066-\u2069\ud800-\udfff]/u.test(reason)) invalid('apply-reason must contain 1-1000 valid characters without control or dangerous Unicode characters.');
            body.apply_reason = reason;
        }
        return { method: 'POST', path, body };
    }
    path += '/sessions';
    if (name === 'session-list') return { method: 'GET', path, query: { page_size: args['page-size'] ?? 20, ...query } };
    if (name === 'session-create') return { method: 'POST', path };
    path += `/${encodeURIComponent(required(args, 'session-id'))}`;
    if (name === 'session-get') return { method: 'GET', path };
    if (name === 'chat') return { method: 'POST', path: `${path}/chat`, body: { message: required(args, 'message') } };
    const turn = required(args, 'turn-id');
    if (name === 'session-stop') return { method: 'POST', path: `${path}/stop`, body: { turn_id: turn } };
    return { method: 'GET', path: `${path}/turns/${encodeURIComponent(turn)}/reply_message`, query };
}
function isObject(value: unknown): value is JsonObject { return !!value && typeof value === 'object' && !Array.isArray(value); }
function aliases(source: JsonObject, names: [string, string][]): JsonObject {
    const result = { ...source };
    for (const [canonical, alternate] of names) {
        if (!(canonical in source) && !(alternate in source)) continue;
        const valid = (value: unknown) => canonical === 'submitted_by' ? isObject(value) : canonical === 'created_at' ? value != null && value !== '' : typeof value === 'string' && value !== '';
        if (!valid(source[canonical]) && valid(source[alternate])) result[canonical] = source[alternate];
        else if (!(canonical in source)) result[canonical] = source[alternate];
        delete result[alternate];
    }
    return result;
}
export function sessionResult(name: string, data: JsonObject): JsonObject {
    if (name === 'release-create') return { release_id: typeof data.release_id === 'string' ? data.release_id : '', status: typeof data.status === 'string' ? data.status : '', sync: data.sync === true };
    if (name !== 'release-get') return data;
    const result: JsonObject = { ...(isObject(data.release) ? data.release : data) };
    delete result.release;
    for (const key of ['error_logs', 'current_node_info']) if (key in data) result[key] = data[key];
    if (isObject(result.current_node_info)) {
        const node = aliases(result.current_node_info, [['current_node', 'currentNode'], ['current_status', 'currentStatus'], ['created_at', 'createdAt'], ['submitted_by', 'submittedBy']]);
        if (isObject(node.result)) node.result = aliases(node.result, [['approval_url', 'approvalURL']]);
        if (isObject(node.submitted_by)) node.submitted_by = aliases(node.submitted_by, [['open_id', 'openID']]);
        result.current_node_info = node;
    }
    return result;
}

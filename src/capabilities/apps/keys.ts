import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function route(value: JsonObject) {
    if (Object.keys(value).some((key) => !['http_method', 'http_path'].includes(key))) invalid('Unknown scope route field.');
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(value.http_method))) invalid('Unsupported scope HTTP method.');
    if (typeof value.http_path !== 'string' || !value.http_path.startsWith('/') || value.http_path.includes('..') || value.http_path.includes('//')) invalid('Invalid scope API path.');
    return value;
}
function config(args: JsonObject): JsonObject | undefined {
    const raw = typeof args.scope === 'string' ? args.scope.trim() : '';
    const apis = Array.isArray(args['scope-api']) ? args['scope-api'] : [];
    let scope: JsonObject | undefined;
    if (raw) {
        if (args['scope-all'] === true || apis.length) invalid('scope cannot be combined with scope-all or scope-api.');
        let value: unknown; try { value = JSON.parse(raw); } catch { invalid('scope must be valid JSON.'); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('scope must be a JSON object.');
        scope = value as JsonObject;
        if (Object.keys(scope).some((key) => !['allow_all', 'http_infos'].includes(key))) invalid('Unknown scope field.');
        if ('allow_all' in scope && typeof scope.allow_all !== 'boolean') invalid('allow_all must be boolean.');
        if ('http_infos' in scope) {
            if (!Array.isArray(scope.http_infos)) invalid('http_infos must be an array.');
            scope.http_infos.forEach((item) => route(object(item)));
        }
    } else if (args['scope-all'] === true || apis.length) {
        scope = { allow_all: args['scope-all'] === true };
        if (apis.length) scope.http_infos = apis.map((value) => {
            if (typeof value !== 'string') invalid('scope-api must contain strings.');
            const parts = value.trim().split(/\s+/);
            if (parts.length !== 2) invalid('scope-api must use METHOD /path.');
            return route({ http_method: parts[0]!.toUpperCase(), http_path: parts[1] });
        });
    }
    const result: JsonObject = {};
    if (scope) result.request_scope = scope;
    if ('allow-preview' in args) result.is_allow_access_preview = args['allow-preview'];
    return Object.keys(result).length ? result : undefined;
}
export function keyRequest(action: string, args: JsonObject, path: string, preview: boolean): ApiRequest {
    path += '/oapi_apikeys';
    if (!['list', 'create'].includes(action)) {
        if (typeof args['key-id'] !== 'string' || !args['key-id'].trim()) invalid('key-id must not be blank.');
        path += `/${encodeURIComponent(args['key-id'].trim())}`;
    }
    if (['delete', 'reset'].includes(action) && !preview && args.yes !== true) throw new ServiceError('CONFIRMATION_REQUIRED', 'Explicit yes=true is required.');
    if (action === 'list') return { method: 'GET', path, query: Object.fromEntries(['limit', 'offset'].filter((key) => key in args).map((key) => [key, args[key]])) };
    if (action === 'get') return { method: 'GET', path };
    if (action === 'delete') return { method: 'DELETE', path };
    if (action === 'reset') return { method: 'POST', path: `${path}/refresh` };
    if (action === 'enable' || action === 'disable') return { method: 'PATCH', path, body: { status: action === 'enable' ? 1 : 0 } };
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    if (action === 'create' && !name) invalid('name must not be blank.');
    if (action === 'update' && !name && !('scope-all' in args) && !(Array.isArray(args['scope-api']) && args['scope-api'].length) && !(typeof args.scope === 'string' && args.scope.trim()) && !('allow-preview' in args)) invalid('Provide name, scope, or allow-preview.');
    const keyConfig = config(args);
    return { method: action === 'create' ? 'POST' : 'PATCH', path, body: { ...(name ? { name } : {}), ...(keyConfig ? { config: keyConfig } : {}) } };
}
function redact(value: unknown) {
    const { api_key: secret, ...rest } = object(value);
    return { ...rest, key_preview: typeof secret === 'string' && secret.length > 4 ? `****${secret.slice(-4)}` : '****' };
}
export function keyResult(action: string, args: JsonObject, data: JsonObject): JsonObject {
    if (action === 'list') return { infos: (Array.isArray(data.infos) ? data.infos : []).map((info) => info && typeof info === 'object' && !Array.isArray(info) ? redact(info) : info) };
    if (action === 'delete') return { api_key_id: String(args['key-id']).trim(), deleted: true };
    if (action === 'create' || action === 'reset') {
        const info = object(data.info);
        return { api_key_id: data.api_key_id || info.api_key_id || '', api_key: info.api_key || data.api_key || '', info: redact(info) };
    }
    return { info: redact(data.info) };
}

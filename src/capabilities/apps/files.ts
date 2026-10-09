import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function string(args: JsonObject, key: string) { return typeof args[key] === 'string' ? args[key].trim() : ''; }
export function timestamp(value: string): string {
    const relative = /^(\d+)([smhdw])$/.exec(value);
    let date: Date;
    if (relative) date = new Date(Date.now() - Number(relative[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[relative[2]!]!));
    else {
        if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) invalid('Invalid timestamp.');
        const plain = value.length === 10 ? `${value}T00:00:00Z` : /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
        const y = Number(value.slice(0, 4)), m = Number(value.slice(5, 7)), d = Number(value.slice(8, 10));
        if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) invalid('Invalid timestamp date.');
        date = new Date(plain);
    }
    if (!Number.isFinite(date.getTime())) invalid('Invalid timestamp.');
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
export function fileRequest(name: string, args: JsonObject, path: string, preview: boolean): ApiRequest {
    if (!string(args, 'app-id').startsWith('app_')) invalid('Storage requires a real app_ ID.');
    path += '/storage';
    if (name === 'file-quota-get') return { method: 'GET', path: `${path}/file_quota` };
    if (name === 'file-list') {
        const size = args['page-size'] ?? 20;
        if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > 200) invalid('page-size must be 1-200.');
        const query: JsonObject = { page_size: size };
        for (const key of ['name', 'path', 'type', 'page-token', 'uploaded-since', 'uploaded-until']) {
            const value = string(args, key); if (value) query[key.replaceAll('-', '_')] = key.startsWith('uploaded-') ? timestamp(value) : value;
        }
        for (const key of ['size-gt', 'size-lt']) if (typeof args[key] === 'number' && args[key] > 0) query[key.replaceAll('-', '_')] = args[key];
        return { method: 'GET', path: `${path}/file_list`, query };
    }
    if (name === 'file-delete') {
        const paths = Array.isArray(args.path) ? args.path.filter((value) => typeof value === 'string').map((value: string) => value.trim()).filter(Boolean) : [];
        if (!paths.length) invalid('Provide at least one path.');
        if (!preview && args.yes !== true) throw new ServiceError('CONFIRMATION_REQUIRED', 'Explicit yes=true is required.');
        return { method: 'POST', path: `${path}/file_batch_remove`, body: { paths } };
    }
    const file = string(args, 'path'); if (!file) invalid('path must not be blank.');
    if (name === 'file-get') return { method: 'GET', path: `${path}/file`, query: { path: file } };
    const expiry = args['expires-in'] ?? 86400;
    if (typeof expiry !== 'number' || !Number.isInteger(expiry) || expiry > 2592000) invalid('expires-in cannot exceed 2592000 seconds.');
    return { method: 'POST', path: `${path}/file_sign`, body: { path: file, ...(expiry > 0 ? { expires_in: expiry } : {}) } };
}
function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function info(data: JsonObject): JsonObject {
    const result: JsonObject = { file_name: typeof data.file_name === 'string' ? data.file_name : '', path: typeof data.path === 'string' ? data.path : '' };
    if (data.size_bytes != null) result.size_bytes = data.size_bytes;
    for (const [source, target] of [['type', 'type'], ['created_at', 'uploaded_at'], ['download_url', 'download_url']] as const) if (typeof data[source] === 'string' && data[source]) result[target] = data[source];
    if (typeof data.created_by === 'string') {
        try {
            const user = object(JSON.parse(data.created_by));
            if ((user.id == null || typeof user.id === 'string') && (user.name == null || typeof user.name === 'string') && (user.id || user.name)) result.uploaded_by = { id: user.id ?? '', name: user.name ?? '' };
        } catch { /* An unparseable optional uploader is omitted. */ }
    }
    return result;
}
export function fileResult(name: string, request: ApiRequest, data: JsonObject): JsonObject {
    if (name === 'file-get') return info(data);
    if (name === 'file-list') return { ...data, items: (Array.isArray(data.items) ? data.items : []).filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map(info) };
    if (name === 'file-quota-get') {
        const result: JsonObject = { storage_used_bytes: data.storage_used_bytes ?? null };
        if ('files' in data) result.files = data.files;
        if (Number(data.storage_quota_bytes) > 0) {
            result.storage_quota_bytes = data.storage_quota_bytes;
            const percent = data.usage_percent;
            if ((typeof percent === 'number' || typeof percent === 'string' && percent.trim()) && Number.isFinite(Number(percent))) result.usage_percent = Math.round(Number(percent) * 10) / 10;
        }
        return result;
    }
    if (name === 'file-delete') {
        const paths = (request.body as JsonObject).paths as string[], rows = Array.isArray(data.results) ? data.results : [];
        return { results: paths.map((path, index) => {
            const row = object(rows[index]), status = typeof row.status === 'string' && row.status || 'ok';
            if (status === 'ok') return { path, status, ...(row.file && typeof row.file === 'object' && !Array.isArray(row.file) ? { file_name: object(row.file).file_name ?? '' } : {}) };
            const code = typeof row.error_code === 'string' && row.error_code || 'DELETE_FAILED';
            return { path, status, error: { code, message: code === 'FILE_NOT_FOUND' ? `File '${path}' does not exist` : `Failed to delete '${path}'` } };
        }) };
    }
    return data;
}

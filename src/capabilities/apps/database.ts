import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function text(args: JsonObject, key: string) { return typeof args[key] === 'string' ? args[key].trim() : ''; }
function required(args: JsonObject, key: string) { const value = text(args, key); if (!value) invalid(`${key} must not be blank.`); return value; }
function fields(args: JsonObject, names: string[]) { return Object.fromEntries(names.filter((key) => text(args, key)).map((key) => [key.replaceAll('-', '_'), text(args, key)])); }
export function databaseRequest(name: string, args: JsonObject, path: string, preview: boolean): ApiRequest {
    if ('env' in args) invalid('Use environment instead of the removed env flag.');
    const env = text(args, 'environment');
    if (env && !['dev', 'online'].includes(env)) invalid('environment must be dev or online.');
    const query: JsonObject = env ? { env } : {};
    if (name === 'db-env-create') {
        if (env && env !== 'dev') invalid('Only dev can be initialized.');
        if (!preview && args.yes !== true) throw new ServiceError('CONFIRMATION_REQUIRED', 'Explicit yes=true is required.');
        return { method: 'POST', path: `${path}/db_dev_init`, body: { sync_data: args['sync-data'] === true } };
    }
    if (name === 'db-table-get') return { method: 'GET', path: `${path}/tables/${encodeURIComponent(required(args, 'table'))}`, query };
    if (name === 'db-table-list') return { method: 'GET', path: `${path}/tables`, query: { ...query, page_size: args['page-size'] ?? 20, ...fields(args, ['page-token']) } };
    if (name === 'db-quota-get') return { method: 'GET', path: `${path}/db/quota`, query };
    if (name === 'db-audit-status') return { method: 'GET', path: `${path}/db/audit_status`, query: { ...query, ...fields(args, ['table']) } };
    if (name === 'db-sync-list') {
        const size = args['page-size'] ?? 20;
        if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) invalid('page-size must be positive.');
        return { method: 'GET', path: `${path}/db/sync_list`, query: { ...query, page_size: size, ...fields(args, ['mode', 'status', 'table', 'page-token']) } };
    }
    const task = required(args, 'task-id');
    if (name === 'db-sync-get') return { method: 'GET', path: `${path}/db/sync_task`, query: { task_id: task } };
    if (name === 'db-sync-delete' && !preview && args.yes !== true) throw new ServiceError('CONFIRMATION_REQUIRED', 'Explicit yes=true is required.');
    const action = name.slice('db-sync-'.length);
    return { method: 'POST', path: `${path}/db/sync_${action === 'delete' ? 'del' : action}`, body: { task_id: task } };
}
function items(data: JsonObject): JsonObject[] { return (Array.isArray(data.items) ? data.items : []).filter((item) => item && typeof item === 'object' && !Array.isArray(item)); }
export function databaseResult(name: string, args: JsonObject, data: JsonObject): JsonObject {
    if (name === 'db-table-list') return { ...data, items: items(data).map((item) => ({ name: text(item, 'name'), description: text(item, 'description'),
        ...(item.estimated_row_count != null ? { estimated_row_count: item.estimated_row_count } : {}), ...(item.size_bytes != null ? { size_bytes: item.size_bytes } : {}), column_count: Array.isArray(item.columns) ? item.columns.length : 0 })) };
    if (name === 'db-audit-status') {
        const rows = items(data).map((item) => ({ table: text(item, 'table'), enabled: item.enabled === true, ...fields(item, ['enabled_at', 'retention']) }));
        const table = text(args, 'table');
        if (table && !rows.length) return { table, enabled: false };
        return table && rows.length === 1 ? rows[0]! : { items: rows };
    }
    if (name === 'db-quota-get') {
        const result: JsonObject = { storage_used_bytes: data.storage_used_bytes ?? null };
        for (const key of ['tables', 'views']) if (key in data) result[key] = data[key];
        const quota = Number(data.storage_quota_bytes);
        if (Number.isFinite(quota) && quota > 0) {
            result.storage_quota_bytes = data.storage_quota_bytes;
            const percent = data.usage_percent;
            if ((typeof percent === 'number' || typeof percent === 'string' && percent.trim()) && Number.isFinite(Number(percent))) result.usage_percent = Math.round(Number(percent) * 10) / 10;
        }
        return result;
    }
    return data;
}

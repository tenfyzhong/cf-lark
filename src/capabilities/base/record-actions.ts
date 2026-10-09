import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { recordDefinitions } from './record-definitions';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function prepare(name: string, args: JsonObject): ApiRequest {
    for (const key of ['base-token', 'table-id']) if (typeof args[key] !== 'string' || !args[key].trim()) invalid(`${key} is required.`);
    const base = `/open-apis/base/v3/bases/${encodeURIComponent(String(args['base-token']))}`;
    if (name === 'record-upsert' || name.startsWith('record-batch-')) {
        let body = args.json;
        if (typeof body === 'string') { try { body = JSON.parse(body); } catch { invalid('Invalid json.'); } }
        if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('json must be an object.');
        const records = `${base}/tables/${encodeURIComponent(String(args['table-id']).trim())}/records`;
        if (name === 'record-upsert') return { method: args['record-id'] ? 'PATCH' : 'POST', path: records + (args['record-id'] ? `/${encodeURIComponent(String(args['record-id']))}` : ''), body };
        return { method: 'POST', path: `${records}/${name.endsWith('create') ? 'batch_create' : 'batch_update'}`, body };
    }
    if (name === 'record-history-list') {
        const size = args['page-size'] ?? 30;
        if (typeof args['record-id'] !== 'string' || !args['record-id'].trim()) invalid('record-id is required.');
        if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > 50) invalid('Invalid page-size.');
        if (args['max-version'] !== undefined && (typeof args['max-version'] !== 'number' || !Number.isInteger(args['max-version']) || args['max-version'] <= 0)) invalid('max-version must be positive.');
        return { method: 'GET', path: `${base}/record_history`, query: { table_id: String(args['table-id']).trim(), record_id: args['record-id'], page_size: size, ...(args['max-version'] !== undefined ? { max_version: args['max-version'] } : {}) } };
    }
    const share = name === 'record-share-link-create';
    let value = args['record-id'] ?? (share ? args['record-ids'] : undefined);
    if (!share && args.json !== undefined) {
        if (Array.isArray(value) && value.length) invalid('record-id and json are mutually exclusive.');
        let body = args.json;
        if (typeof body === 'string') { try { body = JSON.parse(body); } catch { invalid('Invalid json.'); } }
        if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('json must be an object.');
        value = (body as JsonObject).record_id_list;
        const projection = (body as JsonObject).select_fields;
        if (projection !== undefined && projection !== null && (!Array.isArray(projection) || !projection.length || projection.length > 100 || !projection.every(x => typeof x === 'string' && x.trim()) || new Set(projection.map(x => String(x).trim())).size !== projection.length)) invalid('Invalid select_fields.');
    }
    if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) invalid('record-id must be a string array.');
    let records = value as string[];
    if (share) records = [...new Set(records.filter(Boolean))];
    else {
        records = records.map(id => id.trim());
        if (records.some(id => !id) || new Set(records).size !== records.length) invalid('record-id must be nonblank and unique.');
    }
    if (!records.length || records.length > (share ? 100 : 200)) invalid('The record selection exceeds its allowed size.');
    return { method: 'POST', path: `${base}/tables/${encodeURIComponent(String(args['table-id']).trim())}/records/${share ? 'share_links/batch' : 'batch_delete'}`, body: { [share ? 'record_ids' : 'record_id_list']: records } };
}
export function recordActionCapabilities(): Capability[] {
    return recordDefinitions.map(definition => ({ definition, preview: async args => ({ requests: [prepare(definition.id.slice('base.+'.length), args)] }), execute: async (args, context) => { const name = definition.id.slice('base.+'.length); const data = await context.lark.request(prepare(name, args)); return name === 'record-upsert' ? { record: data, [args['record-id'] ? 'updated' : 'created']: true } : data; } }));
}

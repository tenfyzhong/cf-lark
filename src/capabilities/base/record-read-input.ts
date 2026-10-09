import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
export const invalid = (message: string): never => { throw new ServiceError('INVALID_ARGUMENTS', message); };
export const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const alias = (args: JsonObject, keys: string[], fallback?: unknown): unknown => { const present = keys.filter(key => args[key] !== undefined); if (present.length > 1) invalid(`${present.join(', ')} are mutually exclusive.`); return present.length ? args[present[0]!] : fallback; };
export function parse(value: unknown, key: string): unknown { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return invalid(`${key} must contain valid JSON.`); } }
function strings(value: unknown, maximum: number, required = false): string[] {
    const values = value === undefined || value === null ? [] : typeof value === 'string' ? [value] : value;
    if (!Array.isArray(values) || values.some(item => typeof item !== 'string' || !item.trim())) invalid('Expected nonempty string values.');
    const result = (values as string[]).map(item => item.trim());
    if ((required && !result.length) || result.length > maximum || new Set(result).size !== result.length) invalid(`Provide ${required ? 'one' : 'zero'} to ${maximum} unique values.`);
    return result;
}
function csv(value: string): string[] {
    const result: string[] = []; let current = '', quoted = false;
    for (let i = 0; i < value.length; i++) { const char = value[i]; if (char === '"') { if (quoted && value[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted; } else if (char === ',' && !quoted) { result.push(current); current = ''; } else current += char; }
    if (quoted) invalid('Unclosed CSV quote.'); result.push(current); return result;
}
function sort(value: unknown): unknown[] { const parsed = parse(value, 'sort-json'), values = object(parsed) ? parsed.sort_config : parsed; if (!Array.isArray(values) || values.length > 10) invalid('sort must contain at most ten conditions.'); return values as unknown[]; }
export interface ReadPlan { request: ApiRequest; format: string; args: JsonObject; offset: number; limit: number; action: string; }
export function prepareRecordRead(action: string, args: JsonObject): ReadPlan {
    const base = String(args['base-token'] ?? '').trim(), table = String(alias(args, ['table-id', 'table']) ?? '').trim();
    if (!base || !table) invalid('base-token and table-id are required.');
    const output = String(args.output ?? '').trim(), format = String(args.format ?? (output ? 'ndjson' : 'markdown'));
    if (!['markdown', 'json', 'ndjson'].includes(format)) invalid('Invalid record format.');
    if (output && (format !== 'ndjson' || !output.endsWith('.ndjson'))) invalid('output requires ndjson format and a .ndjson filename.');
    if (format !== 'ndjson' && (args['minimal-stdout'] || args['jq-records'] || args.overwrite)) invalid('Export flags require ndjson format.');
    if (args['minimal-stdout'] && args['jq-records']) invalid('minimal-stdout and jq-records are mutually exclusive.');
    let projectionValue = alias(args, ['field-id', 'field', 'fields', 'field-names']);
    if (args['field-names'] !== undefined) projectionValue = (Array.isArray(projectionValue) ? projectionValue : [projectionValue]).flatMap(value => csv(String(value)));
    if (args.fields !== undefined) projectionValue = (Array.isArray(projectionValue) ? projectionValue : [projectionValue]).flatMap(value => typeof value === 'string' && value.trim().startsWith('[') ? parse(value, 'fields') as unknown[] : csv(String(value)));
    const projection = strings(projectionValue, action === 'search' ? 50 : 100, projectionValue !== undefined);
    const request: ApiRequest = { method: action === 'list' ? 'GET' : 'POST', path: `/open-apis/base/v3/bases/${encodeURIComponent(base)}/tables/${encodeURIComponent(table)}/records${action === 'get' ? '/batch_get' : action === 'search' ? '/search' : ''}` };
    const defaultLimit = format === 'ndjson' ? 2000 : action === 'list' ? 100 : 10;
    let limit = Number(alias(args, ['limit', 'page-size'], defaultLimit)), offset = Number(args.offset ?? 0);
    if (!Number.isInteger(offset)) invalid('offset must be an integer.'); offset = Math.max(0, offset);
    if (action === 'get') {
        if (args.json !== undefined && args['record-id'] !== undefined) invalid('record-id and json are mutually exclusive.');
        const body = args.json === undefined ? {} : parse(args.json, 'json'); if (!object(body)) invalid('json must be an object.');
        const value = body as JsonObject, ids = strings(args['record-id'] ?? value.record_id_list, 200, true);
        if (projection.length && value.select_fields != null) invalid('Projection flags and json.select_fields are mutually exclusive.');
        const selected = value.select_fields == null ? projection : strings(value.select_fields, 100, true);
        request.body = { record_id_list: ids, ...(selected.length ? { select_fields: selected } : {}) };
        limit = ids.length; offset = 0;
    } else {
        let body: JsonObject = {};
        const view = alias(args, ['view-id', 'view']);
        if (action === 'search' && args.json !== undefined) {
            for (const key of ['keyword', 'search-field', 'field-id', 'field', 'fields', 'field-names', 'view-id', 'view', 'offset', 'limit', 'page-size']) if (args[key] !== undefined) invalid(`json and ${key} are mutually exclusive.`);
            const parsed = parse(args.json, 'json'); if (!object(parsed)) invalid('json must be an object.'); body = { ...parsed as JsonObject };
            if (body.select_fields === null) delete body.select_fields;
            else if (body.select_fields !== undefined) body.select_fields = strings(body.select_fields, 50);
            if (body.sort !== undefined) body.sort = sort(body.sort);
            offset = Number(body.offset ?? 0); limit = Number(body.limit ?? defaultLimit);
            if (!Number.isInteger(offset) || offset < 0) invalid('JSON offset must be a nonnegative integer.');
        } else {
            if (action === 'search') { if (!String(args.keyword ?? '').trim()) invalid('keyword is required.'); body.keyword = String(args.keyword).trim(); body.search_fields = strings(args['search-field'], 20, true); }
            if (projection.length) body[action === 'list' ? 'field_id' : 'select_fields'] = projection;
            if (view) body.view_id = view;
        }
        if (!Number.isInteger(limit) || limit < 1 || limit > (format === 'ndjson' ? 2000 : 200)) invalid('Invalid record limit.');
        if (args['filter-json'] !== undefined) { const value = parse(args['filter-json'], 'filter-json'); if (!object(value)) invalid('filter-json must be an object.'); body.filter = value; }
        if (args['sort-json'] !== undefined) { const values = sort(args['sort-json']); if (values.length) body.sort = values; }
        Object.assign(body, { offset, limit });
        if (action === 'list') { for (const key of ['filter', 'sort']) if (body[key] !== undefined) body[key] = JSON.stringify(body[key]); request.query = body; request.queryEncoding = { field_id: 'repeat' }; }
        else request.body = body;
    }
    return { request, format, args: { ...args, 'base-token': base, 'table-id': table, format, ...(output ? { output } : {}) }, offset, limit, action };
}

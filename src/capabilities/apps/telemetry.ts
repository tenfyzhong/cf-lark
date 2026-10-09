import type { JsonObject } from '../../domain/models';
export const object = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);
export const text = (v: unknown) => typeof v === 'string' ? v : '';
export const maps = (v: unknown): JsonObject[] => Array.isArray(v) ? v.filter(object) : [];
export function first(row: JsonObject, keys: string[]) { for (const key of keys) if (key in row) return row[key]; return null; }
export function firstString(row: JsonObject, keys: string[]) { for (const key of keys) if (text(row[key]).trim()) return text(row[key]); return ''; }
export function firstMaps(row: JsonObject, keys: string[]) { for (const key of keys) if (Array.isArray(row[key])) return maps(row[key]); return []; }
export function kv(raw: unknown): JsonObject { return object(raw) ? { ...raw } : Object.fromEntries(maps(raw).map((item) => [String(first(item, ['key', 'name']) ?? '').trim(), first(item, ['value'])]).filter(([key]) => key)); }
export function aliases(row: JsonObject, fields: Record<string, string[]>): JsonObject {
    const out = { ...row };
    const attrs = kv(out.attributes); if (Object.keys(attrs).length) out.attributes = attrs;
    for (const [name, keys] of Object.entries(fields)) for (const key of [name, ...keys]) if (key in row) { out[name] = row[key]; break; }
    return out;
}
export function logItem(row: JsonObject) {
    const out = aliases(row, { log_id: ['id', 'logID', 'logId'], trace_id: ['traceID', 'traceId'], timestamp_ns: ['timestampNs'], severity_text: ['severityText'] });
    const level = firstString(out, ['level', 'severity_text', 'severityText']); if (level) out.level = level; return out;
}
export function page(data: JsonObject, items: JsonObject[]): JsonObject {
    const token = firstString(data, ['page_token', 'next_page_token', 'pageToken', 'nextPageToken']);
    const hasMore = typeof data.has_more === 'boolean' ? data.has_more : typeof data.hasMore === 'boolean' ? data.hasMore : false;
    return { items, ...(token ? { page_token: token } : {}), has_more: hasMore };
}
const summaryFields = { trace_id: ['traceID', 'traceId'], start_time_ns: ['startTimeNs'], root_span: ['rootSpan'], user_id: ['userID', 'userId'], duration_ms: ['durationMs'], span_count: ['spanCount'] };
function span(row: JsonObject) {
    const out = aliases(row, { ...summaryFields, span_id: ['spanID', 'spanId'], parent_span_id: ['parentSpanID', 'parentSpanId'], start_time_ns: ['startTimeNs', 'start_time_unix_nano', 'startTimeUnixNano'], end_time_ns: ['endTimeNs', 'end_time_unix_nano', 'endTimeUnixNano'], is_break: ['isBreak'] });
    const attrs = kv(row.attributes); for (const key of ['duration_ms', 'user_id', 'status', 'module']) if (!(key in out) && attrs[key] != null) out[key] = attrs[key]; return out;
}
function numeric(value: unknown): bigint | number | null {
    if (typeof value !== 'string' && typeof value !== 'number' || typeof value === 'string' && !value.trim()) return null;
    if (/^[+-]?\d+$/.test(String(value))) { try { return BigInt(String(value)); } catch { return null; } }
    const n = Number(value); return Number.isFinite(n) ? n : null;
}
export function traceList(data: JsonObject): JsonObject {
    const keys = ['items', 'trace_items', 'traceItems', 'spans', 'span_items', 'spanItems'], key = keys.find((key) => key in data) ?? '', rows = maps(data[key]);
    const ids = rows.map((r) => firstString(r, ['trace_id', 'traceID', 'traceId'])).filter(Boolean);
    if (!key.startsWith('span') && new Set(ids).size === ids.length) return page(data, rows.map((r) => aliases(r, summaryFields)));
    const groups = new Map<string, JsonObject[]>(), ungrouped: JsonObject[] = [];
    for (const raw of rows) { const row = span(raw), id = text(row.trace_id); if (!id) ungrouped.push(aliases(row, summaryFields)); else groups.set(id, [...groups.get(id) ?? [], row]); }
    const items = [...groups].map(([id, spans]) => {
        const root = spans.find((r) => firstString(r, ['root_span', 'rootSpan'])) ?? spans.find((r) => r.parent_span_id == null || typeof r.parent_span_id === 'string' && !r.parent_span_id.trim()) ?? spans.find((r) => firstString(r, ['name', 'span_name', 'spanName'])) ?? spans[0]!;
        const result: JsonObject = { ...aliases(root, summaryFields), trace_id: id, span_count: spans.length };
        if (!text(result.root_span).trim()) { const name = firstString(root, ['name', 'span_name', 'spanName']) || spans.map((r) => firstString(r, ['name', 'span_name', 'spanName'])).find(Boolean); if (name) result.root_span = name; }
        if (!text(result.user_id).trim()) { const user = spans.map((r) => firstString(r, ['user_id', 'userID', 'userId'])).find(Boolean); if (user) result.user_id = user; }
        for (const field of ['start_time_ns', 'duration_ms']) { let chosen: unknown, best: bigint | number | null = null; for (const row of spans) { const value = row[field], number = numeric(value); if (number !== null && (best === null || (field === 'start_time_ns' ? number < best : number > best))) { best = number; chosen = value; } } if (best !== null) result[field] = chosen; }
        const statuses = spans.map((r) => text(r.status)).filter((s) => s.trim()); if (statuses.length) result.status = statuses.some((s) => s.toUpperCase() === 'ERROR') ? 'ERROR' : statuses[0];
        return result;
    });
    return page(data, [...items, ...ungrouped]);
}
export function traceDetail(data: JsonObject): JsonObject {
    const row = [data.trace, data.trace_detail, data.traceDetail].find(object) ?? data, out = aliases(row, { trace_id: ['traceID', 'traceId'], is_break: ['isBreak'] });
    const spans = firstMaps(row, ['spans', 'span_items', 'spanItems']).map(span);
    if (spans.length) { out.spans = spans; if (!text(out.trace_id)) { const id = text(spans[0]!.trace_id); if (id) out.trace_id = id; } } return out;
}
function pointValues(point: JsonObject, labels: string[], mapping: Record<string, string>): JsonObject {
    const out: JsonObject = {}, raw = first(point, ['values', 'value_map', 'valueMap']);
    if (object(raw)) { for (const label of labels) if (label in raw) out[label] = raw[label]; for (const [name, label] of Object.entries(mapping)) if (name in raw) out[label] = raw[name]; }
    if (Array.isArray(raw)) raw.forEach((value, i) => { if (object(value)) { const label = mapping[String(first(value, ['metric_name', 'metricName', 'name']))] ?? labels[i]; if (label) out[label] = first(value, ['value']); } else if (labels[i]) out[labels[i]!] = value; });
    for (const label of labels) if (label in point) out[label] = point[label];
    if (labels.length === 1 && 'value' in point) out[labels[0]!] = point.value;
    return out;
}
function nested(row: JsonObject) { for (const key of ['data_points', 'dataPoints', 'points', 'items']) { const rows = maps(row[key]); if (rows.length) return rows; } return []; }
function dimensions(row: JsonObject) { for (const key of ['dimensions', 'dimension', 'labels', 'tags']) { if (object(row[key])) return { ...row[key] }; const out = kv(row[key]); if (Object.keys(out).length) return out; } return {}; }
export function seriesResult(data: JsonObject, names: string[], labels: string[], analytics: boolean, fillZero: boolean): JsonObject {
    const mapping = Object.fromEntries(names.map((name, i) => [name, labels[i]!])), timeField = analytics ? 'timestamp_ns' : 'timestamp';
    const timestamp = (point: JsonObject) => first(point, analytics ? [timeField, 'timestampNs', 'time_ns', 'timeNs', 'time', 'ts'] : [timeField, 'timestampSec', 'time', 'ts']);
    let source = maps(data.series), grouped = source.length > 0;
    if (!source.length) { source = maps(data.items); grouped = source.some((row) => nested(row).length > 0); }
    if (!source.length) for (const key of ['points', 'data_points', 'dataPoints']) { source = maps(data[key]); if (source.length) break; }
    const items: JsonObject[] = [], indexes = new Map<string, JsonObject>();
    if (grouped) source.forEach((serie, i) => {
        let label = ''; for (const key of ['label', 'series', 'name', 'metric_name', 'metricName', 'metric_type', 'metricType']) { const value = text(serie[key]).trim(); label = mapping[value] ?? (labels.includes(value) ? value : ''); if (label) break; } label ||= labels[i] ?? ''; if (!label) return;
        const points = nested(serie); for (const point of points.length ? points : [serie]) {
            const time = timestamp(point), dims = dimensions(point), key = JSON.stringify([String(time), Object.fromEntries(Object.entries(dims).sort())]);
            let output = indexes.get(key); if (!output) { output = { [timeField]: time, dimensions: dims, values: {} }; indexes.set(key, output); items.push(output); }
            const raw = first(point, ['values', 'value_map', 'valueMap']); let value: unknown = null;
            if ('value' in point) value = point.value;
            else if (object(raw)) { const name = Object.keys(mapping).find((name) => mapping[name] === label && name in raw); value = name ? raw[name] : raw[label] ?? null; }
            else if (Array.isArray(raw)) { const row = raw.find((v) => object(v) && mapping[String(first(v, ['metric_name', 'metricName', 'name']))] === label); value = object(row) ? first(row, ['value']) : raw.find((v) => !object(v)) ?? null; }
            (output.values as JsonObject)[label] = value;
        }
    }); else for (const point of source) items.push({ [timeField]: timestamp(point), dimensions: dimensions(point), values: pointValues(point, labels, mapping) });
    for (const item of items) { const values = item.values as JsonObject; if (fillZero || analytics && Object.values(values).some((v) => v != null)) for (const label of labels) if (values[label] == null) values[label] = 0; }
    return { items, has_more: false };
}

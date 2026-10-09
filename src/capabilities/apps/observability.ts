import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest, LarkClient } from '../../ports/lark';
import { timestamp } from './files';
import { object, text, maps, first, firstString, firstMaps, kv, logItem, page, traceList, traceDetail, seriesResult } from './telemetry';
export const observabilityNames = ['log-list', 'log-get', 'trace-list', 'trace-get', 'metric-list', 'analytics-list'];
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function repeated(value: unknown): string[] { if (value === undefined) return []; if (!Array.isArray(value)) invalid('Repeated filters must be arrays.'); return [...new Set(value.map((v) => text(v).trim()).filter(Boolean))]; }
function time(raw: string): bigint {
    const relative = /^(\d+(?:\.\d+)?)([smhdw])$/.exec(raw);
    if (relative && Number(relative[1]) > 0) { const multiplier = ({ s: 1, m: 60, h: 3600, d: 86400, w: 604800 } as Record<string, number>)[relative[2]!]!; const delta = Number(relative[1]) * multiplier * 1e9; if (!Number.isFinite(delta) || delta > 9223372036854775807) invalid('Relative duration exceeds the supported range.'); return BigInt(Date.now()) * 1000000n - BigInt(Math.trunc(delta)); }
    const fraction = /\.(\d{1,9})(?:Z|[+-]\d\d:\d\d)?$/.exec(raw)?.[1];
    const normalized = timestamp(raw), milliseconds = Date.parse(normalized);
    return BigInt(milliseconds) * 1000000n + (fraction ? BigInt(fraction.padEnd(9, '0')) : 0n);
}
function range(args: JsonObject, defaults: boolean) {
    let since = text(args.since).trim() ? time(text(args.since).trim()) : undefined, until = text(args.until).trim() ? time(text(args.until).trim()) : undefined;
    if (defaults) { until ??= BigInt(Date.now()) * 1000000n; since ??= until - 30n * 86400n * 1000000000n; }
    if (since !== undefined && until !== undefined && since > until) invalid('until must be greater than or equal to since.');
    return { since, until };
}
function series(args: JsonObject, analytics: boolean) {
    const family = text(args[analytics ? 'analytics' : 'metric']).trim().toLowerCase(), selected = text(args.series).trim().toLowerCase(), filter: JsonObject = {};
    const definitions: Record<string, [string[], string[]]> = analytics ? { users: [['ACTIVE_USER', 'NEW_USER', 'TOTAL_USER'], ['active-users', 'new-users', 'total-users']], 'page-view': [['PAGE_VIEW'], ['all']] } : { requests: [['client_api_request_count', 'client_api_request_error_count'], ['total', 'error']], latency: [['client_api_request_latency_p50', 'client_api_request_latency_p99'], ['p50', 'p99']], cpu: [['cpu_usage'], ['cpu']], memory: [['mem_usage'], ['memory']] };
    const definition = definitions[family]; if (!definition) invalid('Unknown metric or analytics family.');
    let [names, labels] = definition;
    if (analytics) {
        const device = text(args['device-type']).trim().toLowerCase(); if (device && !['desktop', 'mobile'].includes(device)) invalid('device-type must be desktop or mobile.'); if (device) filter.device_types = [device];
        if (family === 'page-view') {
            const mapped = selected.replace(/-view$/, '') || 'all'; if (!['all', 'desktop', 'mobile'].includes(mapped)) invalid('Invalid page-view series.');
            if (mapped !== 'all') { if (device && mapped !== device) invalid('device-type conflicts with series.'); filter.device_types = [mapped]; labels = [mapped]; }
        } else if (selected) { const mapped = selected.endsWith('-users') ? selected : `${selected}-users`, index = labels.indexOf(mapped); if (index < 0) invalid('Invalid user analytics series.'); names = [names[index]!]; labels = [labels[index]!]; }
    } else if (selected) { const index = labels.indexOf(selected); if (['cpu', 'memory'].includes(family) || index < 0) invalid('Invalid metric series.'); names = [names[index]!]; labels = [labels[index]!]; }
    return { names, labels, filter, fillZero: !analytics && family === 'requests' };
}
export function observabilityRequest(name: string, args: JsonObject): ApiRequest {
    const app = text(args['app-id']).trim(), environment = text(args.environment).trim(); if (!app || environment && environment !== 'online') invalid('Provide app-id; observability supports only online.');
    const path = `/open-apis/spark/v1/apps/${encodeURIComponent(app)}`, body: JsonObject = {};
    if (['metric-list', 'analytics-list'].includes(name)) {
        const analytics = name === 'analytics-list', spec = series(args, analytics), { since, until } = range(args, true);
        body[analytics ? 'metric_types' : 'metric_names'] = spec.names; body.need_pack_lack_point = false;
        body[analytics ? 'start_timestamp_ns' : 'start_timestamp'] = String(analytics ? since! : since! / 1000000000n);
        body[analytics ? 'end_timestamp_ns' : 'end_timestamp'] = String(analytics ? until! : until! / 1000000000n);
        if (analytics) { const unit = text(args.granularity).trim().toLowerCase() || 'day'; if (!['day', 'week', 'month'].includes(unit)) invalid('Invalid granularity.'); body.time_aggregation_unit = unit.toUpperCase(); if (text(args.page).trim()) spec.filter.page = text(args.page).trim(); }
        else { const interval = 'down-sample' in args ? text(args['down-sample']).trim() || '1m' : until! - since! <= 21600n * 1000000000n ? '1m' : until! - since! <= 604800n * 1000000000n ? '1h' : '1d'; if (!['1m', '1h', '1d'].includes(interval)) invalid('Invalid down-sample.'); body.down_sample = interval; for (const [flag, key] of [['page', 'pages'], ['api', 'apis']]) { const values = repeated(args[flag!]); if (values.length) spec.filter[key!] = values; } }
        if (Object.keys(spec.filter).length) body.filter = spec.filter;
        return { method: 'POST', path: `${path}/${analytics ? 'query_analytics_data' : 'query_metrics_data'}`, body };
    }
    body.app_env = 'runtime';
    if (name === 'trace-get') { if (!text(args['trace-id']).trim()) invalid('trace-id is required.'); body.trace_id = text(args['trace-id']).trim(); return { method: 'POST', path: `${path}/trace`, body }; }
    if (name === 'log-get') { if (!text(args['log-id']).trim()) invalid('log-id is required.'); body.limit = 1; body.filter = { log_ids: [text(args['log-id']).trim()] }; }
    else {
        const limit = args['page-size'] ?? 50; if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) invalid('page-size must be between 1 and 100.'); body.limit = limit;
        if (text(args['page-token']).trim()) body.page_token = text(args['page-token']).trim(); const { since, until } = range(args, false); if (since !== undefined) body.start_timestamp_ns = String(since); if (until !== undefined) body.end_timestamp_ns = String(until);
        const filter: JsonObject = {}, traces = repeated(args['trace-id']); if (traces.length) filter.trace_ids = traces;
        const keyword = text(args[name === 'trace-list' ? 'root-span' : 'keyword']).trim(); if (keyword) filter.keyword = keyword;
        for (const [flag, key] of name === 'trace-list' ? [['user-id', 'user_ids']] : [['module', 'modules'], ['user-id', 'user_ids'], ['page', 'pages'], ['api', 'apis']]) if (text(args[flag!]).trim()) filter[key!] = [text(args[flag!]).trim()];
        if (name === 'log-list') { const levels = repeated(args.level).map((v) => v.toUpperCase()); if (levels.some((v) => !['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(v))) invalid('Invalid log level.'); if (levels.length) filter.levels = levels;
            for (const flag of ['min-duration', 'max-duration']) if (flag in args) { const value = args[flag]; if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) invalid('Duration bounds must be nonnegative integers.'); filter[flag.replace('-', '_') + '_ms'] = value; }
            if (Number(args['min-duration']) > Number(args['max-duration'])) invalid('max-duration must be at least min-duration.'); }
        if (Object.keys(filter).length) body.filter = filter;
    }
    return { method: 'POST', path: `${path}/${name === 'trace-list' ? 'search_traces' : 'search_logs'}`, body, ...(name === 'log-get' ? { responseMode: 'envelope' as const } : {}) };
}
function frame(raw: unknown): JsonObject | null {
    if (typeof raw === 'string') { const match = /^\s*(?:at\s+(.+?)\s+)?\((.+):(\d+):(\d+)\)\s*$/.exec(raw) ?? /^\s*(?:at\s+)?(.+):(\d+):(\d+)\s*$/.exec(raw); if (!match) return null; return frame(match.length === 5 ? { file: match[2], line: match[3], column: match[4], function: match[1] } : { file: match[1], line: match[2], column: match[3] }); }
    if (!object(raw)) return null;
    const file = firstString(raw, ['file_name', 'fileName', 'filename', 'file', 'url']).trim().split(/[/?#]/).filter(Boolean).at(-1), line = Number(first(raw, ['line', 'line_number', 'lineNumber'])), column = Number(first(raw, ['column', 'col', 'column_number', 'columnNumber']));
    if (!file || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) return null;
    const fn = firstString(raw, ['function', 'function_name', 'functionName', 'method', 'methodName']); return { file_name: file, line, column, ...(fn ? { function: fn } : {}) };
}
function frames(raw: unknown): JsonObject[] {
    if (typeof raw === 'string') { try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return frames(parsed); } catch { /* Plain JavaScript stack text. */ } raw = raw.split('\n'); }
    return Array.isArray(raw) ? raw.map(frame).filter((v): v is JsonObject => v !== null).slice(0, 2000) : [];
}
async function enrich(log: JsonObject, path: string, lark: LarkClient) {
    if (firstString(log, ['level', 'severity_text', 'severityText']).toUpperCase() !== 'ERROR') return;
    const sources: JsonObject[] = []; let signal = false;
    function scan(value: unknown, depth: number) { if (depth > 8) return; if (object(value)) { sources.push(value); for (const [key, nested] of Object.entries(value)) { signal ||= /source_?map/.test(key.toLowerCase().replace(/[- ]/g, '_')); scan(nested, depth + 1); } } else if (Array.isArray(value)) { const attrs = kv(value); if (Object.keys(attrs).length) { sources.push(attrs); Object.values(attrs).forEach((v) => scan(v, depth + 1)); } value.forEach((v) => scan(v, depth + 1)); } else if (typeof value === 'string') { signal ||= /source_?map|\.js/.test(value.toLowerCase().replace(/[- ]/g, '_')); try { const parsed = JSON.parse(value); if (object(parsed)) scan(parsed, depth + 1); } catch { /* Text metadata. */ } } }
    scan(log, 0); const find = (keys: string[]) => sources.map((source) => firstString(source, keys)).find(Boolean) ?? '';
    const release = find(['release_commit_id', 'releaseCommitID', 'releaseCommitId']), commit = find(['commit_id', 'commitID', 'commitId', 'release_commit_id', 'releaseCommitID', 'releaseCommitId']), prefix = find(['source_map_file_prefix', 'sourceMapFilePrefix', 'source_map_prefix', 'sourceMapPrefix']) || (release ? 'client/assets/' : '');
    let stack: JsonObject[] = [];
    for (const key of ['frames', 'stack_frames', 'stackFrames', 'source_stack_frames', 'sourceStackFrames', 'stack', 'stack_trace', 'stackTrace', 'error_stack', 'errorStack', 'exception_stack', 'exceptionStack', 'message', 'body']) { for (const source of sources) { stack = frames(source[key]); if (stack.length) break; } if (stack.length) break; }
    if (!commit || !prefix || !stack.length) { if (signal) { log.source_stack_status = 'unresolved'; log.source_stack_reason = 'source stack fields incomplete'; } return; }
    const tenant = find(['tenant_id', 'tenantID', 'tenantId']);
    try { const result = await lark.request({ method: 'POST', path: path.replace(/search_logs$/, 'resolve_stack_trace'), body: { commit_id: commit, source_map_file_prefix: prefix, frames: stack, ...(tenant ? { tenant_id: tenant } : {}) } }); log.source_stack_status = 'resolved'; log.source_stack = first(result, ['source_stack', 'sourceStack', 'frames']) ?? result; }
    catch (error) { if (error instanceof ServiceError) { log.source_stack_status = 'unresolved'; log.source_stack_reason = 'resolve_stack_trace failed'; if (error.details?.upstreamCode) { log.source_stack_error_code = error.details.upstreamCode; log.source_stack_reason += `: code ${error.details.upstreamCode}`; } if (error.details?.logId) log.source_stack_log_id = error.details.logId; } }
}
export async function observabilityExecute(name: string, args: JsonObject, request: ApiRequest, lark: LarkClient): Promise<JsonObject> {
    const response = await lark.request(request);
    const data = name === 'log-get' ? Array.isArray(response) ? { items: response } : Array.isArray(response.data) ? { ...response, items: response.data } : object(response.data) ? response.data : response : response;
    if (name === 'trace-list') return traceList(data); if (name === 'trace-get') return traceDetail(data);
    if (name === 'metric-list' || name === 'analytics-list') { const analytics = name === 'analytics-list', spec = series(args, analytics); return seriesResult(data, spec.names, spec.labels, analytics, spec.fillZero); }
    const items = firstMaps(data, ['items', 'log_items', 'logItems']).map(logItem);
    if (name === 'log-list') return page(data, items);
    const log = items[0]; if (!log) throw new ServiceError('FAILED_PRECONDITION', 'Log not found. Verify log-id and environment online.');
    await enrich(log, request.path, lark); return log;
}

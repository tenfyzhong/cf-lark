import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram } from '../../ports/workflows';
import { timestamp } from './files';
export const auditNames = ['db-audit-list', 'db-audit-enable', 'db-audit-disable', 'db-changelog-list'];
const text = (value: unknown) => typeof value === 'string' ? value : '';
const object = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);
const rows = (v: unknown): JsonObject[] => Array.isArray(v) ? v.filter(object) : [];
function tables(args: JsonObject) { return Array.isArray(args.table) ? args.table.map((v) => text(v).trim()).filter(Boolean) : []; }
function parse(raw: string): unknown { try { return JSON.parse(raw); } catch { return raw; } }
export function auditRequest(name: string, args: JsonObject): ApiRequest {
    const app = text(args['app-id']).trim(), env = text(args.environment).trim();
    if (!app || 'env' in args || env && !['dev', 'online'].includes(env)) throw new ServiceError('INVALID_ARGUMENTS', 'Provide app-id and a valid environment.');
    const path = `/open-apis/spark/v1/apps/${encodeURIComponent(app)}/db`, query: JsonObject = env ? { env } : {};
    if (name.endsWith('-enable') || name.endsWith('-disable')) {
        const table = text(args.table).trim(), retention = text(args.retention) || '7d', enabled = name.endsWith('-enable');
        if (!table || enabled && !['7d', '30d', '180d', '360d', 'forever'].includes(retention)) throw new ServiceError('INVALID_ARGUMENTS', 'Provide table and a supported retention.');
        return { method: 'POST', path: `${path}/audit_set`, query, body: { table, enabled, ...(enabled ? { retention } : {}) } };
    }
    query.page_size = args['page-size'] ?? 20;
    for (const key of ['since', 'until']) if (text(args[key]).trim()) query[key] = timestamp(text(args[key]).trim());
    if (text(args['page-token']).trim()) query.page_token = text(args['page-token']).trim();
    if (name === 'db-audit-list') {
        if (!tables(args).length) throw new ServiceError('INVALID_ARGUMENTS', 'table must contain at least one table.');
        query.tables = tables(args).join(',');
    } else for (const key of ['table', 'change-id']) if (text(args[key]).trim()) query[key.replaceAll('-', '_')] = text(args[key]).trim();
    return { method: 'GET', path: `${path}/${name === 'db-audit-list' ? 'audit_list' : 'changelog_list'}`, query };
}
export function auditResult(name: string, data: JsonObject): JsonObject {
    const audit = name === 'db-audit-list';
    return { ...data, items: rows(data.items).map((row) => {
        const result: JsonObject = Object.fromEntries((audit ? ['event_id', 'event_time', 'target_table', 'type', 'summary'] : ['change_id', 'changed_at', 'target_table', 'change_type', 'summary']).map((key) => [key, text(row[key])]));
        const raw = text(row.operator).trim();
        if (raw) { const value = parse(raw); result.operator = object(value) && typeof value.id !== 'number' && typeof value.name !== 'number' ? { id: text(value.id), name: text(value.name) || text(value.id) } : { id: raw, name: raw }; }
        if (!audit && text(row.statement)) result.statement = row.statement;
        if (audit) for (const key of ['before', 'after']) if (text(row[key])) { const value = parse(text(row[key])); if (value !== null) result[key] = value; }
        return result;
    }) };
}
export function auditPrograms(): WorkflowProgram[] {
    return ['db-audit-enable', 'db-audit-disable', 'db-audit-list'].map((name): WorkflowProgram => ({ id: `apps-${name}`, version: 1, domain: 'apps', risk: name === 'db-audit-list' ? 'read' : 'write', identities: ['user'], async step(state, context) {
        const args = state.args as JsonObject, request = auditRequest(name, args);
        if (name === 'db-audit-list') state = { ...state, args: { ...args, ...(request.query?.since ? { since: request.query.since } : {}), ...(request.query?.until ? { until: request.query.until } : {}) } };
        if (name !== 'db-audit-list') {
            if (Date.now() < Number(state.nextAttempt)) return { done: false, state };
            try {
                const data = await context.lark.request(request), status = object(data.status) ? data.status : {}, body = request.body as JsonObject;
                return { done: true, output: { table: text(status.table) || body.table, enabled: body.enabled, ...(body.enabled ? { retention: text(status.retention) || body.retention } : {}) } };
            } catch (error) {
                const attempt = Number(state.attempt ?? 0);
                if (!object(error) || !object(error.details) || error.details.reason !== 'dts_lock_contention' || attempt >= 3) throw error;
                return { done: false, state: { ...state, attempt: attempt + 1, nextAttempt: Date.now() + 400 * 2 ** attempt } };
            }
        }
        const requested = tables(args), env = request.query?.env ? { env: request.query.env } : {};
        if (requested.length > 1 && state.phase === 'schema') {
            if (Number(state.pages ?? 0) >= 100) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Table pagination exceeded 100 pages.', 502);
            const data = await context.lark.request({ method: 'GET', path: request.path.replace('/db/audit_list', '/tables'), query: { ...env, page_size: 100, ...(state.cursor ? { page_token: state.cursor } : {}) } });
            const existing = [...(state.existing as string[] ?? []), ...rows(data.items).map((row) => text(row.name)).filter(Boolean)], cursor = text(data.page_token);
            const more = data.has_more === true && !!cursor, seen = state.seen as string[] ?? [];
            if (more && seen.includes(cursor)) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Table pagination repeated a cursor.', 502);
            return { done: false, state: { ...state, existing, phase: more ? 'schema' : 'status', cursor, seen: [...seen, cursor], pages: Number(state.pages ?? 0) + 1 } };
        }
        if (requested.length > 1 && state.phase === 'status') {
            const data = await context.lark.request({ method: 'GET', path: request.path.replace(/audit_list$/, 'audit_status'), query: env });
            const enabled = new Set(rows(data.items).filter((row) => row.enabled === true).map((row) => text(row.table))), existing = new Set(state.existing as string[]);
            const skipped = requested.filter((table) => !existing.has(table) || !enabled.has(table)).map((table) => ({ table, reason: !existing.has(table) ? 'table not found' : 'audit not enabled' }));
            const valid = requested.filter((table) => existing.has(table) && enabled.has(table));
            if (!valid.length) return { done: true, output: { items: [], has_more: false, skipped } };
            return { done: false, state: { ...state, phase: 'list', valid, skipped } };
        }
        const data = await context.lark.request({ ...request, query: { ...request.query, tables: (state.valid as string[] ?? requested).join(',') } });
        const result = auditResult(name, data); delete result.skipped;
        if (Array.isArray(state.skipped) && state.skipped.length) result.skipped = state.skipped;
        return { done: true, output: result };
    } }));
}

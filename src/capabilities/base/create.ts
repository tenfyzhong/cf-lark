import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { WorkflowProgram } from '../../ports/workflows';
function object(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
const str = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const id = (value: JsonObject) => str(value.id) || str(value.table_id);
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function upstream(message: string): never { throw new ServiceError('UPSTREAM_ERROR', message, 502); }
export function baseCreateInput(name: string, args: JsonObject): JsonObject {
    if (!str(args[name === 'base-copy' ? 'base-token' : 'name'])) invalid(`${name === 'base-copy' ? 'base-token' : 'name'} is required.`);
    if (args.fields === undefined) return args;
    if (typeof args.fields === 'string' && !args.fields.trim()) { const result = { ...args }; delete result.fields; return result; }
    let fields = args.fields;
    if (typeof fields === 'string') { try { fields = JSON.parse(fields); } catch { invalid('fields must be valid JSON.'); } }
    if (!Array.isArray(fields) || !fields.every(object)) invalid('fields must be an array of objects.');
    return { ...args, fields };
}
function defaultTable(base: JsonObject): string {
    for (const key of ['table_id', 'default_table_id']) if (str(base[key])) return str(base[key]);
    for (const key of ['table', 'default_table']) if (object(base[key]) && id(base[key] as JsonObject)) return id(base[key] as JsonObject);
    for (const key of ['tables', 'default_tables']) if (Array.isArray(base[key])) { const first = (base[key] as unknown[])[0]; if (object(first) && id(first)) return id(first); }
    return '';
}
interface State extends JsonObject { args: JsonObject; phase: string; token: string; table: string; output: JsonObject; createdAt: number }
export function baseCreatePrograms(): WorkflowProgram[] {
    return ['base-create', 'base-copy'].map(name => ({ id: `base-${name}`, version: 1, domain: 'base', risk: 'write', identities: ['user', 'bot'], step: async (raw, context) => {
        const state = raw as State, copy = name === 'base-copy';
        if (state.phase === 'start') return { done: false, state: { args: baseCreateInput(name, state.args), phase: 'submit' } };
        const a = state.args;
        const pending = (patch: JsonObject) => ({ done: false as const, state: { ...state, ...patch } });
        const route = `/open-apis/base/v3/bases/${encodeURIComponent(state.token)}/tables`;
        if (state.phase === 'submit') {
            const body: JsonObject = copy ? {} : { name: a.name };
            for (const key of ['folder-token', 'time-zone', ...(copy ? ['name'] : [])]) if (str(a[key])) body[key.replaceAll('-', '_')] = str(a[key]);
            if (copy && a['without-content']) body.without_content = true;
            const base = await context.lark.request({ method: 'POST', path: `/open-apis/base/v3/bases${copy ? `/${encodeURIComponent(String(a['base-token']))}/copy` : ''}`, body });
            const token = str(base.base_token) || str(base.app_token), table = defaultTable(base);
            const output = { base, [copy ? 'copied' : 'created']: true };
            if (!copy && (a.fields !== undefined || str(a['table-name']))) {
                if (!token) upstream('The created Base response omitted its token.');
                return pending({ token, table, output, phase: table ? 'table' : 'find-table' });
            }
            return pending({ token, output, phase: 'permission' });
        }
        if (state.phase === 'find-table') {
            const data = await context.lark.request({ method: 'GET', path: route, query: { offset: 0, limit: 100 } });
            const values = Array.isArray(data.tables) && data.tables.length ? data.tables : Array.isArray(data.items) ? data.items : data.id ? [data] : [];
            const table = values.find(object);
            if (!table || !id(table)) upstream('The default Base table could not be resolved.');
            return pending({ table: id(table), phase: 'table' });
        }
        if (state.phase === 'table') {
            const custom = Array.isArray(a.fields);
            const body = { name: str(a['table-name']) || 'Table 1', ...(custom && (a.fields as unknown[]).length ? { fields: a.fields } : {}) };
            const table = await context.lark.request({ method: custom ? 'POST' : 'PATCH', path: custom ? route : `${route}/${encodeURIComponent(state.table)}`, body });
            if (custom && !id(table)) upstream('The replacement table response omitted its ID.');
            const output = { ...state.output, table, ...(custom ? { fields: Array.isArray(table.fields) ? table.fields : [] } : { default_table_renamed: true, renamed_default_table_id: state.table }) };
            return pending({ output, phase: custom ? 'delete-default' : 'permission', createdAt: Date.now() });
        }
        if (state.phase === 'delete-default') {
            const remaining = state.createdAt + 1000 - Date.now();
            if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
            await context.lark.request({ method: 'DELETE', path: `${route}/${encodeURIComponent(state.table)}` });
            return pending({ output: { ...state.output, default_table_deleted: true, deleted_default_table_id: state.table }, phase: 'permission' });
        }
        if (context.selection.identity !== 'bot') return { done: true, output: state.output };
        const accounts = context.grant.profiles.find(profile => profile.profileId === context.selection.profileId)?.accounts ?? [];
        const user = context.selection.accountId && accounts.includes(context.selection.accountId) ? context.selection.accountId : !context.selection.accountId && accounts.length === 1 ? accounts[0] : undefined;
        let status = 'skipped';
        if (user && state.token) {
            try {
                await context.lark.request({ method: 'POST', path: `/open-apis/drive/v1/permissions/${encodeURIComponent(state.token)}/members`, query: { type: 'bitable', need_notification: false }, body: { member_type: 'openid', member_id: user, perm: 'full_access', type: 'user' } }); status = 'granted';
            } catch { status = 'failed'; }
        }
        return { done: true, output: { ...state.output, permission_grant: { status, perm: 'full_access', ...(user ? { user_open_id: user, member_type: 'openid' } : {}), message: status === 'granted' ? 'The authorized user received full_access.' : 'The Base was created, but automatic user access was not granted.', ...(status === 'granted' ? {} : { hint: 'Authorize an unambiguous user account or grant permission through the Lark document UI.' }) } } };
    } }));
}

import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram } from '../../ports/workflows';
import { timestamp } from './files';
export const databaseWorkflowNames = ['db-env-migrate', 'db-recovery-diff', 'db-recovery-apply'];
function text(value: unknown) { return typeof value === 'string' ? value : ''; }
function rows(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((v) => v && typeof v === 'object' && !Array.isArray(v)) : []; }
function integer(value: unknown) { const number = Number(value); return Number.isFinite(number) ? Math.trunc(number) : 0; }
export function databaseJobRequest(name: string, args: JsonObject, preview: boolean): ApiRequest {
    const app = text(args['app-id']).trim();
    if (!app) throw new ServiceError('INVALID_ARGUMENTS', 'app-id must not be blank.');
    if ('env' in args || args.environment && !['dev', 'online'].includes(text(args.environment))) throw new ServiceError('INVALID_ARGUMENTS', 'Use environment dev or online.');
    if (!preview && ['db-env-migrate', 'db-recovery-apply'].includes(name) && args.yes !== true) throw new ServiceError('CONFIRMATION_REQUIRED', 'Explicit yes=true is required.');
    const recovery = name.startsWith('db-recovery-');
    const target = recovery ? timestamp(text(args.target).trim()) : undefined;
    if (recovery && !target) throw new ServiceError('INVALID_ARGUMENTS', 'target is required.');
    return { method: 'POST', path: `/open-apis/spark/v1/apps/${encodeURIComponent(app)}/db/${recovery ? 'env_recovery' : 'env_migrate'}`,
        ...(recovery ? { query: args.environment ? { env: args.environment } : {} } : {}),
        body: { ...(recovery ? { target } : {}), dry_run: name.endsWith('-diff') } };
}
export function migrationDiff(data: JsonObject): JsonObject {
    return { from: text(data.from), to: text(data.to), changes: rows(data.changes).map((row) => ({ type: text(row.type), table: text(row.table), statement: text(row.statement) })) };
}
function recoveryDiff(target: unknown, data: JsonObject): JsonObject {
    const raw = rows(data.changes), schema = new Set(raw.filter((row) => text(row.action)).map((row) => text(row.table)));
    const changes = raw.filter((row) => text(row.action) || !schema.has(text(row.table))).map((row) => ({ table: text(row.table),
        ...(row.inserted != null ? { inserted: row.inserted } : {}), ...(row.deleted != null ? { deleted: row.deleted } : {}),
        ...(text(row.action) ? { action: row.action } : {}), ...(text(row.dropped_at) ? { dropped_at: row.dropped_at } : {}) }));
    return { target, tables_affected: new Set(changes.map((row) => row.table)).size, changes, estimated_seconds: integer(data.estimated_seconds) || 30 };
}
export function databasePrograms(): WorkflowProgram[] {
    return databaseWorkflowNames.map((name): WorkflowProgram => ({ id: `apps-${name}`, version: 1, domain: 'apps', risk: name.endsWith('-diff') ? 'read' : 'write', identities: ['user'],
        async step(state, context) {
            const args = state.args as JsonObject, request = databaseJobRequest(name, args, false), recovery = name.startsWith('db-recovery-'), diff = name.endsWith('-diff');
            const pending = (next: JsonObject) => ({ done: false as const, state: next });
            if (state.phase === 'prepare' && !recovery) {
                let preview: JsonObject = {};
                try { preview = await context.lark.request({ ...request, body: { dry_run: true } }); } catch { /* Upstream treats migration preview as best effort. */ }
                return pending({ ...state, phase: 'submit', from: text(preview.from), to: text(preview.to), count: rows(preview.changes).length });
            }
            if (state.phase === 'submit' || state.phase === 'prepare' && recovery) {
                const data = await context.lark.request(request), target = (request.body as JsonObject).target;
                if (recovery && !diff && text(data.status).toLowerCase() === 'no_changes') return { done: true, output: { status: 'no_changes', target } };
                const task = recovery ? data.preview_request_id : data.task_id;
                if (diff && !text(task)) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Recovery preview omitted its request ID.', 502);
                const count = integer(data.changes_applied) || rows(data.changes).length;
                const next: JsonObject = { ...state, phase: 'poll', ...(recovery ? { target } : { from: text(data.from) || state.from, to: text(data.to) || state.to, count: count || state.count }), task: text(task), deadline: Date.now() + 120000, nextPoll: Date.now() + (recovery && !diff ? 2000 : 1000) };
                if (!recovery && !text(task)) return { done: true, output: { status: 'migrated', from: next.from, to: next.to, changes_applied: next.count } };
                return pending(next);
            }
            if (state.phase !== 'poll') throw new ServiceError('INVALID_ARGUMENTS', 'Invalid database workflow phase.');
            if (Date.now() >= Number(state.deadline)) throw new ServiceError('UPSTREAM_TIMEOUT', 'Database operation did not complete within two minutes.', 504);
            if (Date.now() < Number(state.nextPoll)) return pending(state);
            const suffix = recovery ? diff ? 'env_recovery_diff_status' : 'env_recovery_apply_status' : 'env_migrate_status';
            const data = await context.lark.request({ method: 'GET', path: request.path.replace(/[^/]+$/, suffix), query: recovery ? { ...request.query, ...(diff ? { preview_request_id: state.task } : {}) } : { task_id: state.task } });
            const status = text(data[diff ? 'preview_status' : 'status']).toLowerCase();
            if (status === 'failed') throw new ServiceError('UPSTREAM_ERROR', 'The database operation failed upstream.', 502);
            if ((diff ? ['success'] : recovery ? ['success', 'restored', 'ready'] : ['success', 'applied', 'migrated']).includes(status)) {
                return { done: true, output: diff ? recoveryDiff(state.target, data) : recovery ? { status: 'restored', target: state.target, ...(integer(data.restore_time_sec) > 0 ? { restore_time_sec: integer(data.restore_time_sec) } : {}) } : { status: 'migrated', from: state.from, to: state.to, changes_applied: integer(data.changes_applied) || state.count } };
            }
            return pending({ ...state, nextPoll: Date.now() + (recovery && !diff ? 2000 : 1000) });
        },
    }));
}

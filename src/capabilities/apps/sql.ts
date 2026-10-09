import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram } from '../../ports/workflows';
function string(value: unknown) { return typeof value === 'string' ? value : ''; }
function object(value: unknown): value is JsonObject { return !!value && typeof value === 'object' && !Array.isArray(value); }
function parse(value: string): unknown { try { return JSON.parse(value); } catch { return undefined; } }
export function sqlRequest(args: JsonObject, preview: boolean): ApiRequest {
    const app = string(args['app-id']).trim(), sql = string(args.sql), file = string(args.file).trim();
    if (!app || !!sql.trim() === !!file) throw new ServiceError('INVALID_ARGUMENTS', 'Provide app-id and exactly one nonblank sql or file artifact.');
    if ('env' in args || args.environment && !['dev', 'online'].includes(string(args.environment))) throw new ServiceError('INVALID_ARGUMENTS', 'Use environment dev or online.');
    if (!preview && args.yes !== true) throw new ServiceError('CONFIRMATION_REQUIRED', 'Explicit yes=true is required.');
    return { method: 'POST', path: `/open-apis/spark/v1/apps/${encodeURIComponent(app)}/sql_commands`, query: { transactional: false, ...(args.environment ? { env: args.environment } : {}) }, body: { sql: file ? '<artifact contents>' : sql } };
}
export function sqlResult(data: JsonObject): unknown {
    const raw = string(data.result), value = parse(raw);
    const statements: JsonObject[] = !raw ? [] : Array.isArray(value) && value.length && value.every(object) && 'sql_type' in value[0]! ? value : Array.isArray(value) && value.every((v) => typeof v === 'string') ? value.map((v) => ({ sql_type: Array.isArray(parse(v)) ? 'SELECT' : 'OK', data: v })) : [{ sql_type: 'RAW', data: raw }];
    let depth = 0;
    for (const [index, statement] of statements.entries()) {
        const type = string(statement.sql_type);
        if (type === 'ERROR') {
            const error = parse(string(statement.data)), code = object(error) ? Number(string(error.code) ? string(error.code).replace(/^k_dl_/, '') : error.code) || 0 : 0;
            if (code === 4000001) throw new ServiceError('FAILED_PRECONDITION', 'Online DDL was rejected before execution. Apply DDL to dev, then migrate.', 400, { upstreamCode: code, applied: false });
            throw new ServiceError('UPSTREAM_ERROR', depth > 0 ? 'SQL failed inside an explicit transaction; changes were rolled back.' : index > 0 ? 'SQL failed after earlier statements committed; retry only remaining statements.' : 'SQL failed before any statements applied.', 502, { upstreamCode: code, statement: index + 1, statements: statements.length, rolledBack: depth > 0, earlierCommitted: depth === 0 && index > 0 });
        }
        if (['BEGIN', 'START TRANSACTION', 'START_TRANSACTION'].includes(type.trim().toUpperCase())) depth++;
        else if (['COMMIT', 'ROLLBACK', 'END'].includes(type.trim().toUpperCase())) depth = Math.max(0, depth - 1);
    }
    const result = statements.map((statement) => {
        const command = string(statement.sql_type), rows = parse(string(statement.data));
        if (command === 'SELECT') { const valid = Array.isArray(rows) && rows.every(object) ? rows : []; return statements.length === 1 ? valid : { command, rows: valid }; }
        if (['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(command)) return { command, rows_affected: Number.isFinite(Number(statement.affected_rows)) ? Math.trunc(Number(statement.affected_rows)) : 0 };
        return { command };
    });
    return result.length === 1 ? result[0] : result;
}
export function sqlProgram(artifacts: ArtifactFiles): WorkflowProgram {
    return { id: 'apps-db-execute', version: 1, domain: 'apps', risk: 'write', identities: ['user'], async step(state, context) {
        const args = state.args as JsonObject, request = sqlRequest(args, false);
        authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
        const metadata = await artifacts.stat(context.grant.id, string(args.file).trim());
        if (metadata.size > 1024 * 1024) throw new ServiceError('FILE_TOO_LARGE', 'SQL artifacts may contain at most 1 MiB.', 413);
        const response = await artifacts.read(context.grant.id, string(args.file).trim()), sql = await response.text();
        if (!sql.trim()) throw new ServiceError('INVALID_ARGUMENTS', 'SQL artifact must not be blank.');
        return { done: true, output: sqlResult(await context.lark.request({ ...request, body: { sql } })) };
    } };
}

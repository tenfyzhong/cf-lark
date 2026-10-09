import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { WorkflowProgram } from '../../ports/workflows';
import { copyDefinitions } from './copy-definitions';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function upstream(message: string): never { throw new ServiceError('UPSTREAM_ERROR', message, 502); }
function object(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function duration(value: unknown): number {
    const text = String(value ?? '5m');
    let remaining = text, total = 0;
    const units: Record<string, number> = { ns: 0.000001, us: 0.001, ms: 1, s: 1000, m: 60000, h: 3600000 };
    while (remaining) {
        const match = /^(\d+(?:\.\d+)?)(ns|us|ms|s|m|h)/.exec(remaining);
        if (!match) invalid('timeout must be a duration such as 30s or 5m.');
        total += Number(match[1]) * units[match[2]!]!; remaining = remaining.slice(match[0].length);
    }
    if (!Number.isFinite(total) || total <= 0 || total > 1800000) invalid('timeout must be positive and at most 30 minutes.');
    return total;
}
export function copyInput(args: JsonObject): JsonObject {
    for (const key of ['base-token', 'table-id', 'name']) if (typeof args[key] !== 'string' || !args[key].trim()) invalid(`${key} is required.`);
    const range = args.range ?? 'schema';
    if (!['schema', 'all'].includes(String(range))) invalid('range must be schema or all.');
    if (args.wait && range !== 'all') invalid('wait requires range all.');
    if (args.timeout !== undefined && (range !== 'all' || !args.wait)) invalid('timeout requires range all and wait.');
    return { ...args, range, duration: duration(args.timeout) };
}
const route = (args: JsonObject) => `/open-apis/base/v3/bases/${encodeURIComponent(String(args['base-token']))}`;
function task(args: JsonObject): string {
    const value = args['task-id'];
    if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).length > 1024) invalid('task-id must be nonblank and at most 1024 bytes.');
    return value;
}
function status(data: JsonObject): { id: string; state: string } {
    const id = String(data.table_id ?? '').trim(), state = String(data.state ?? '').trim().toLowerCase();
    if (!id || !['init', 'process', 'success'].includes(state)) upstream('Invalid table copy status response.');
    return { id, state };
}
function output(args: JsonObject, table: JsonObject, state: string, taskId = '', timedOut = false): JsonObject {
    const completed = state === 'success';
    return { table, ...(args.range ? { range: args.range } : {}), state, completed, ...(taskId ? { task_id: taskId } : {}), ...(timedOut ? { timed_out: true } : {}), ...(!completed ? { next_action: 'poll_status', next_command: { command: 'base.+table-copy-status', args: { 'base-token': args['base-token'], 'task-id': taskId } } } : {}) };
}
async function query(args: JsonObject, taskId: string, context: CommandContext) {
    try { return status(await context.lark.request({ method: 'POST', path: `${route(args)}/copy_table_state`, body: { task_id: taskId } })); }
    catch (error) {
        if (error instanceof ServiceError && error.details?.upstreamCode === 800010109) throw new ServiceError('INVALID_ARGUMENTS', 'The copy task ID is invalid.', 400, { upstreamCode: 800010109 });
        throw error;
    }
}
interface State extends JsonObject { phase: string; args: JsonObject; table: JsonObject; taskId: string; status: string; deadline: number; eligible: number; delay: number }
export const copyProgram: WorkflowProgram = { id: 'base-table-copy', version: 1, domain: 'base', risk: 'write', identities: ['user', 'bot'], step: async (raw, context) => {
    const state = raw as State;
    if (state.phase === 'start') return { done: false, state: { phase: 'submit', args: copyInput(state.args) } };
    const args = state.args;
    if (state.phase === 'submit') {
        const data = await context.lark.request({ method: 'POST', path: `${route(args)}/tables/${encodeURIComponent(String(args['table-id']))}/copy`, body: { name: args.name, range: args.range } });
        const table = object(data.table) ? data.table : {};
        const id = String(table.id ?? '').trim(), taskId = String(data.task_id ?? '').trim(), value = String(data.state ?? '').trim().toLowerCase();
        if (!id || !['init', 'process', 'success'].includes(value) || new TextEncoder().encode(taskId).length > 1024) upstream('Invalid table copy submission response.');
        const projected = { id, ...(table.name ? { name: table.name } : {}) };
        if (args.range === 'schema' && value !== 'success') upstream('Schema copy must complete synchronously.');
        if (args.range === 'all' && value !== 'success' && !taskId) upstream('The asynchronous copy response omitted task_id.');
        if (value === 'success' || !args.wait) return { done: true, output: output(args, projected, value, args.range === 'all' ? taskId : '') };
        return { done: false, nextRunAt: Math.min(Date.now() + 3000, Date.now() + Number(args.duration)), state: { ...state, phase: 'poll', table: projected, taskId, status: value, deadline: Date.now() + Number(args.duration), eligible: Date.now() + 3000, delay: 3000 } };
    }
    if (Date.now() >= state.deadline) return { done: true, output: output(args, state.table, state.status, state.taskId, true) };
    if (Date.now() < state.eligible) return { done: false, nextRunAt: Math.min(state.eligible, state.deadline), state };
    let result: { id: string; state: string };
    try { result = await query(args, state.taskId, context); }
    catch (error) {
        const retryable = error instanceof ServiceError && (error.details?.retryable === true || error.status === 429 || error.status >= 500 || ['NETWORK_ERROR', 'TIMEOUT'].includes(error.code));
        if (retryable) {
            const delay = Math.min(state.delay * 2, 30000);
            return { done: false, nextRunAt: Math.min(Date.now() + delay, state.deadline), state: { ...state, delay, eligible: Date.now() + delay } };
        }
        const recovery = output(args, state.table, state.status, state.taskId);
        if (!(error instanceof ServiceError && [401, 403].includes(error.status))) { delete recovery.next_action; delete recovery.next_command; }
        return { done: true, output: { ...recovery, error: { code: error instanceof ServiceError ? error.code : 'POLL_FAILED', message: 'Status polling failed; the submitted copy has not been repeated.' } } };
    }
    if (result.state === 'success') return { done: true, output: output(args, state.table, result.state, state.taskId) };
    const delay = Math.min(state.delay * 2, 30000);
    return { done: false, nextRunAt: Math.min(Date.now() + delay, state.deadline), state: { ...state, status: result.state, delay, eligible: Date.now() + delay } };
} };
export function copyCapabilities(): Capability[] {
    return copyDefinitions.map(definition => ({ definition, preview: async args => ({ requests: [{ method: 'POST', path: `${route(args)}/copy_table_state`, body: { task_id: task(args) } }] }), execute: async (args, context) => { const id = task(args), result = await query(args, id, context); return output(args, { id: result.id }, result.state, id); } }));
}

import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { WorkflowProgram } from '../../ports/workflows';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function object(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function fieldCreateInput(args: JsonObject): JsonObject[] {
    for (const key of ['base-token', 'table-id']) if (typeof args[key] !== 'string' || !args[key].trim()) invalid(`${key} is required.`);
    let value = args.json;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { invalid('json must contain valid JSON.'); } }
    const bodies = Array.isArray(value) ? value : [value];
    if (!bodies.length || !bodies.every(object)) invalid('json must contain at least one field object.');
    for (const body of bodies) if (['formula', 'lookup'].includes(String(body.type ?? '').trim().toLowerCase()) && args['i-have-read-guide'] !== true) invalid('i-have-read-guide is required for formula and lookup fields.');
    return bodies;
}
function readback(bodies: JsonObject[]) {
    const simple = ['text', 'number', 'select', 'datetime', 'checkbox', 'user', 'group_chat', 'attachment', 'location'];
    const computed = ['formula', 'lookup', 'auto_number', 'link'];
    const first = bodies.find(body => !simple.includes(String(body.type ?? '').trim().toLowerCase()));
    const recommend = !!first;
    const hint = first ? computed.includes(String(first.type ?? '').trim().toLowerCase())
        ? 'computed, linked, or generated field create should be verified with +field-get before declaring completion'
        : 'unknown or uncommon field type; run +field-get to avoid assuming the submitted JSON fully describes server state'
        : 'simple field create succeeded; next_step:done means stop: do not list or get fields unless the user explicitly requests readback or extra properties; if verification is required, filter +field-list with --jq';
    return { field_get_recommended: recommend, verification_hint: hint, next_step: recommend ? 'field_get' : 'done' };
}
interface State extends JsonObject { args: JsonObject; phase: string; bodies: JsonObject[]; fields: JsonObject[]; index: number; started: number }
const identity = (body: JsonObject): JsonObject => ({ name: body.name ?? null, type: body.type ?? null });
export const fieldCreateProgram: WorkflowProgram = {
    id: 'base-field-create', version: 1, domain: 'base', risk: 'write', identities: ['user', 'bot'],
    step: async (raw, context) => {
        const state = raw as State;
        if (state.phase === 'start') return { done: false, state: { ...state, phase: 'write', bodies: fieldCreateInput(state.args), fields: [], index: 0, started: 0 } };
        if (state.index >= state.bodies.length) return { done: true, output: { ...(state.fields.length === 1 ? { field: state.fields[0] } : { fields: state.fields, total: state.fields.length }), created: true, ...readback(state.bodies) } };
        const delay = state.started + 500 - Date.now();
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        const started = Date.now();
        let field: JsonObject;
        try {
            field = await context.lark.request({ method: 'POST', path: '/open-apis/base/v3/' + ['bases', state.args['base-token'], 'tables', String(state.args['table-id']).trim(), 'fields'].map(v => encodeURIComponent(String(v))).join('/'), body: state.bodies[state.index] });
        } catch (error) {
            if (!state.fields.length || !(error instanceof ServiceError) || error.code === 'OUTCOME_UNCERTAIN') throw error;
            const items = state.bodies.map((body, index) => {
                if (index < state.index) {
                    const returned = state.fields[index]!;
                    const value = identity(body);
                    for (const key of ['id', 'name', 'type']) if (Object.hasOwn(returned, key)) value[key] = returned[key];
                    return { index, status: 'created', field: value };
                }
                if (index === state.index) return { index, status: 'failed', field: identity(body), error: error.message, code: error.details?.upstreamCode ?? null, retryable: false };
                return { index, status: 'not_attempted', field: identity(body) };
            });
            return { done: true, output: { summary: { requested: state.bodies.length, attempted: state.index + 1, created: state.fields.length, failed: 1, not_attempted: state.bodies.length - state.index - 1 }, items, ...readback(state.bodies.slice(0, state.index)), next_step: 'inspect_items', hint: 'Some fields were already created and were not rolled back. Inspect the failure before resubmitting failed or not_attempted items.' } };
        }
        return { done: false, state: { ...state, index: state.index + 1, fields: [...state.fields, field], started } };
    },
};

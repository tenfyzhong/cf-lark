import { ServiceError } from '../../domain/errors';
import type { WorkflowProgram } from '../../ports/workflows';
import { choice, content, id, invalid, type Data } from './content';
export function batchPlan(args: Data): Data[] {
    id(args['cycle-id']); choice(args['user-id-type'], ['open_id', 'union_id', 'user_id'], 'open_id');
    if (args['category-id']) id(args['category-id']);
    let input = args.input;
    if (typeof input === 'string') { try { input = JSON.parse(input); } catch { invalid('input must be a JSON array.'); } }
    if (!Array.isArray(input) || !input.length) invalid('input must contain at least one objective.');
    return input.map((item: Data) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) invalid('Each objective must be an object.');
        const body: Data = { content: content({ text: item.text, mention: item.mention }) };
        if (item.notes) body.notes = content({ text: item.notes, mention: item.notes_mention });
        else if (item.notes_mention?.length) invalid('Notes are required with notes_mention.');
        if (item.category_id || args['category-id']) body.category_id = id(item.category_id || args['category-id']);
        if (item.krs !== undefined && !Array.isArray(item.krs)) invalid('krs must be an array.');
        return { body, krs: (item.krs ?? []).map((key: Data) => ({ content: content({ text: key.text, mention: key.mention }) })) };
    });
}
export function batchProgram(): WorkflowProgram {
    return { id: 'okr-batch', version: 1, domain: 'okr', risk: 'write', identities: ['user', 'bot'], step: async (input, context) => {
        const state: Data = input, args: Data = state.args;
        if (state.phase === 'start') return { done: false, state: { ...state, objectives: batchPlan(args), phase: 'objective', index: 0, keyIndex: 0, created: [], residual: [], rollbackErrors: [] } };
        if (state.phase === 'rollback') {
            if (state.rollbackIndex < 0) return { done: true, output: { ok: false, error: state.error, created: state.created, residual_objective_ids: state.residual, rollback_errors: state.rollbackErrors } };
            const target = state.created[state.rollbackIndex].objective_id;
            try { await context.lark.request({ method: 'DELETE', path: `/open-apis/okr/v2/objectives/${encodeURIComponent(target)}`, query: { objective_id: target, yes: true } }); }
            catch (error) {
                if (!(error instanceof ServiceError) || error.code === 'OUTCOME_UNCERTAIN') throw error;
                return { done: false, state: { ...state, rollbackIndex: state.rollbackIndex - 1, residual: [...state.residual, target], rollbackErrors: [...state.rollbackErrors, { objective_id: target, code: error.code, message: error.message }] } };
            }
            return { done: false, state: { ...state, rollbackIndex: state.rollbackIndex - 1 } };
        }
        if (state.index >= state.objectives.length) return { done: true, output: { ok: true, data: { created: state.created } } };
        const objective = state.objectives[state.index], user = args['user-id-type'] ?? 'open_id';
        try {
            if (state.phase === 'objective') {
                const data = await context.lark.request({ method: 'POST', path: `/open-apis/okr/v2/cycles/${args['cycle-id']}/objectives`, query: { cycle_id: args['cycle-id'], user_id_type: user }, body: objective.body });
                if (typeof data.objective_id !== 'string' || !data.objective_id) throw new ServiceError('OUTCOME_UNCERTAIN', 'Created objective response omitted its identifier.');
                return { done: false, state: { ...state, phase: 'key', keyIndex: 0, created: [...state.created, { objective_id: data.objective_id, krs: [] }] } };
            }
            if (state.keyIndex >= objective.krs.length) return { done: false, state: { ...state, phase: 'objective', index: state.index + 1 } };
            const parent = state.created.at(-1).objective_id;
            const data = await context.lark.request({ method: 'POST', path: `/open-apis/okr/v2/objectives/${parent}/key_results`, query: { objective_id: parent, user_id_type: user }, body: objective.krs[state.keyIndex] });
            if (typeof data.key_result_id !== 'string' || !data.key_result_id) throw new ServiceError('OUTCOME_UNCERTAIN', 'Created key result response omitted its identifier.');
            const created = structuredClone(state.created); created.at(-1).krs.push(data.key_result_id);
            return { done: false, state: { ...state, keyIndex: state.keyIndex + 1, created } };
        } catch (error) {
            if (!(error instanceof ServiceError) || error.code === 'OUTCOME_UNCERTAIN') throw error;
            return { done: false, state: { ...state, phase: 'rollback', rollbackIndex: state.created.length - 1, error: { code: error.code, message: error.message } } };
        }
    } };
}

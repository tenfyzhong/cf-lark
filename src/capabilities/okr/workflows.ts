import type { ArtifactFiles } from '../../ports/artifacts';
import { imageProgram } from './image';
import { batchProgram } from './batch';
import { detailProgram } from './details';
import { ServiceError } from '../../domain/errors';
import type { WorkflowProgram } from '../../ports/workflows';
import type { ApiRequest } from '../../ports/lark';
import { choice, id, invalid, type Data } from './content';
export function operations(value: unknown, weight: boolean): Data[] {
    let result = value;
    if (typeof result === 'string') { try { result = JSON.parse(result); } catch { invalid('Operations must be a JSON array.'); } }
    if (!Array.isArray(result) || !result.length) invalid('Operations must be a nonempty array.');
    const ids = new Set(), positions = new Set(); let sum = 0;
    for (const item of result) {
        if (!item || typeof item !== 'object') invalid('Each operation must be an object.');
        if (typeof item.id !== 'string' || !item.id.trim()) invalid('Operation ID must be nonblank.'); if (ids.has(item.id)) invalid('Operation IDs must be unique.'); ids.add(item.id);
        if (weight) { if (typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 1 || Math.abs(item.weight * 1000 - Math.round(item.weight * 1000)) > 1e-8) invalid('Weights must have at most three decimals and lie between zero and one.'); sum += Math.round(item.weight * 1000); }
        else { if (!Number.isInteger(item.position) || item.position < 1 || item.position > 2147483647 || positions.has(item.position)) invalid('Positions must be distinct positive int32 values.'); positions.add(item.position); }
    }
    if (sum > 1000) invalid('Specified weights cannot total more than one.');
    return result;
}
export function editPlan(action: string, args: Data): Data {
    const level = choice(args.level, ['objective', 'key-result']);
    if (action === 'indicator-update') {
        const target = id(args.id), value = Number(args.value);
        if (args.value === undefined || args.value === '' || !Number.isFinite(value)) invalid('Indicator value must be finite.');
        return { request: { method: 'GET', path: `/open-apis/okr/v2/${level === 'objective' ? 'objectives' : 'key_results'}/${target}/indicators`, query: { page_size: 100 } }, value };
    }
    id(args['cycle-id']); const target = level === 'objective' ? args['cycle-id'] : id(args['objective-id']);
    return { request: { method: 'GET', path: `/open-apis/okr/v2/${level === 'objective' ? 'cycles' : 'objectives'}/${target}/${level === 'objective' ? 'objectives' : 'key_results'}`, query: { page_size: '100' } }, ops: operations(args[action === 'weight' ? 'weights' : 'ops'], action === 'weight') };
}
function reordered(items: Data[], ops: Data[]): string[] {
    const positions = new Map<number, string>(ops.map(item => [item.position, item.id]));
    const used = new Set(ops.map(item => item.id)); let position = 1;
    for (const item of items) if (!used.has(item.id)) { while (positions.has(position)) position++; positions.set(position++, item.id); }
    return [...positions].sort((a, b) => a[0] - b[0]).map(item => item[1]);
}
function weights(items: Data[], ops: Data[]): Data[] {
    const specified = new Map<string, number>(ops.map(item => [item.id, Math.round(item.weight * 1000)]));
    const remaining = 1000 - [...specified.values()].reduce((a, b) => a + b, 0);
    const result: Data[] = items.filter(item => specified.has(item.id)).map(item => ({ id: item.id, weight: specified.get(item.id)! / 1000 }));
    const rest = items.filter(item => !specified.has(item.id));
    const original = rest.map(item => Math.round(Math.max(0, Number(item.weight ?? 0)) * 1000));
    const total = original.reduce((a, b) => a + b, 0); let distributed = 0;
    if (rest.length && remaining > 0) rest.forEach((item, index) => {
        const amount = index === rest.length - 1 ? remaining - distributed : Math.floor(total ? remaining * original[index]! / total : remaining / rest.length);
        distributed += amount; result.push({ id: item.id, weight: amount / 1000 });
    });
    else if (remaining > 0 && result.length) result[result.length - 1]!.weight += remaining / 1000;
    if (!result.length) invalid('There are no weighted entities to update.');
    return result;
}
export function okrPrograms(artifacts?: ArtifactFiles): WorkflowProgram[] {
    return [...(artifacts ? [imageProgram(artifacts)] : []), batchProgram(), detailProgram(), { id: 'okr-edit', version: 1, domain: 'okr', risk: 'write', identities: ['user', 'bot'], step: async (input, context) => {
        const state: Data = input, args: Data = state.args;
        if (state.phase === 'start') return { done: false, state: { ...state, ...editPlan(state.action, args), phase: 'read', items: [] } };
        if (state.phase === 'write') { await context.lark.request(state.request); return { done: true, output: state.output }; }
        const data: Data = await context.lark.request(state.request as ApiRequest);
        if (state.action === 'indicator-update') {
            if (!data.indicator?.id) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Indicator response has no ID.');
            return { done: false, state: { ...state, phase: 'write', request: { method: 'PATCH', path: `/open-apis/okr/v2/indicators/${encodeURIComponent(data.indicator.id)}`, body: { current_value: state.value } }, output: { indicator_id: data.indicator.id, current_value: state.value, level: args.level, target_id: args.id } } };
        }
        const items: Data[] = [...state.items, ...(Array.isArray(data.items) ? data.items : [])];
        if (data.has_more && data.page_token) {
            if (data.page_token === state.request.query.page_token) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Pagination cursor did not advance.');
            return { done: false, state: { ...state, items, request: { ...state.request, query: { ...state.request.query, page_token: data.page_token } } } };
        }
        items.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        for (const operation of state.ops) if (!items.some(item => item.id === operation.id)) invalid('An operation ID does not belong to the selected collection.');
        const objective = args.level === 'objective', field = objective ? 'objective' : 'key_result';
        const values = state.action === 'reorder' ? reordered(items, state.ops) : weights(items, state.ops);
        const query = { [objective ? 'cycle_id' : 'objective_id']: args[objective ? 'cycle-id' : 'objective-id'] };
        const body = state.action === 'reorder' ? { [`${field}_ids`]: values } : { [`${field}_weights`]: (values as Data[]).slice().sort((a, b) => items.findIndex(item => item.id === a.id) - items.findIndex(item => item.id === b.id)).map(item => ({ [`${field}_id`]: item.id, weight: item.weight })) };
        return { done: false, state: { ...state, phase: 'write', request: { method: 'PUT', path: `${state.request.path}_${state.action === 'reorder' ? 'position' : 'weight'}`, query, body }, output: { level: args.level, cycle_id: args['cycle-id'], total: items.length, [state.action === 'reorder' ? 'ordered' : 'weights']: values } } };
    } }];
}

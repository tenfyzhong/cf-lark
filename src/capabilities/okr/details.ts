import { ServiceError } from '../../domain/errors';
import type { WorkflowProgram } from '../../ports/workflows';
import { choice, id, simple, threads, time, type Data } from './content';
export function detailPlan(args: Data) {
    const cycle = id(args['cycle-id']); choice(args.style, ['simple', 'richtext'], 'simple');
    return { method: 'GET' as const, path: `/open-apis/okr/v2/cycles/${cycle}/objectives`, query: { page_size: '100' } };
}
function entity(item: Data, style: string, objective: boolean): Data {
    const result: Data = { id: item.id ?? '', create_time: time(item.create_time), update_time: time(item.update_time), owner: item.owner ?? { owner_type: '' }, [objective ? 'cycle_id' : 'objective_id']: item[objective ? 'cycle_id' : 'objective_id'] ?? '' };
    for (const key of ['position', 'score', 'weight', ...(objective ? ['category_id'] : [])]) if (item[key] !== undefined) result[key] = item[key];
    if (item.deadline !== undefined) result.deadline = time(item.deadline);
    for (const key of ['content', ...(objective ? ['notes'] : [])]) if (item[key]?.blocks?.length) result[key] = style === 'simple' ? simple(item[key]) : JSON.stringify(item[key]);
    return result;
}
export function detailProgram(): WorkflowProgram {
    return { id: 'okr-details', version: 1, domain: 'okr', risk: 'read', identities: ['user', 'bot'], step: async (input, context) => {
        const state: Data = input, args: Data = state.args, style = args.style ?? 'simple';
        if (state.phase === 'start') return { done: false, state: { ...state, phase: 'objectives', queue: [{ request: detailPlan(args), owner: args['cycle-id'] }], objectives: [], keys: {}, progresses: [], comments: {} } };
        if (state.queue.length) {
            const job = state.queue[0], response: Data = await context.lark.request(job.request);
            const items: Data[] = Array.isArray(response.items) ? response.items : [], queue = state.queue.slice(1);
            if (response.has_more && response.page_token) {
                if (response.page_token === job.request.query.page_token) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Pagination cursor did not advance.');
                queue.unshift({ ...job, request: { ...job.request, query: { ...job.request.query, page_token: response.page_token } } });
            }
            const next: Data = { ...state, queue };
            if (state.phase === 'objectives') next.objectives = [...state.objectives, ...items];
            if (state.phase === 'keys') next.keys = { ...state.keys, [job.owner]: [...(state.keys[job.owner] ?? []), ...items] };
            if (state.phase === 'progress') next.progresses = [...state.progresses, ...items.map(item => ({ target_type: 'progress', target_id: item.id }))];
            if (state.phase === 'comments') next.comments = { ...state.comments, [job.owner]: [...(state.comments[job.owner] ?? []), ...items] };
            return { done: false, state: next };
        }
        const sort = (items: Data[]) => items.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        if (state.phase === 'objectives') return { done: false, state: { ...state, phase: 'keys', queue: state.objectives.map((item: Data) => ({ owner: item.id, request: { method: 'GET', path: `/open-apis/okr/v2/objectives/${encodeURIComponent(item.id)}/key_results`, query: { page_size: '100' } } })) } };
        if (state.phase === 'keys') {
            if (state.action === 'cycle-detail') return { done: true, output: { cycle_id: args['cycle-id'], style, total: state.objectives.length, objectives: state.objectives.map((item: Data) => ({ ...entity(item, style, true), key_results: sort(state.keys[item.id] ?? []).map(key => entity(key, style, false)) })) } };
            const targets: Data[] = [{ target_type: 'cycle', target_id: args['cycle-id'] }];
            for (const objective of sort(state.objectives)) {
                targets.push({ target_type: 'objective', target_id: objective.id });
                for (const key of sort(state.keys[objective.id] ?? [])) targets.push({ target_type: 'key_result', target_id: key.id });
            }
            return { done: false, state: { ...state, phase: 'progress', targets, queue: targets.filter(item => item.target_type !== 'cycle').map(item => ({ owner: item.target_id, request: { method: 'GET', path: `/open-apis/okr/v2/${item.target_type === 'objective' ? 'objectives' : 'key_results'}/${encodeURIComponent(item.target_id)}/progresses`, query: { page_size: 100, user_id_type: 'open_id', department_id_type: 'open_department_id' } } })) } };
        }
        if (state.phase === 'progress') return { done: false, state: { ...state, phase: 'comments', queue: [...state.targets, ...state.progresses].map(item => ({ owner: item.target_id, request: { method: 'GET', path: '/open-apis/okr/v2/comments', query: { ...item, page_size: 100, user_id_type: 'open_id' } } })) } };
        if (state.phase === 'comments') return { done: true, output: { cycle_id: args['cycle-id'], style, comments: Object.fromEntries(Object.entries(state.comments).map(([key, items]) => [key, threads(items as Data[], style)])) } };
        throw new ServiceError('INVALID_WORKFLOW_STATE', 'Unknown OKR detail phase.');
    } };
}

import { ServiceError } from '../../domain/errors';
type JsonObject = Record<string, any>;
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram } from '../../ports/workflows';

export function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
export function csv(value: unknown): string[] { return String(value ?? '').split(',').map(item => item.trim()).filter(Boolean); }
export function timestamp(value: unknown, end = false): number {
    const input = String(value ?? '').trim();
    let time: number;
    const relative = /^([+-])(\d+)([dwmh])$/.exec(input);
    if (relative) {
        const units: Record<string, number> = { d: 86400000, w: 604800000, m: 60000, h: 3600000 };
        time = Date.now() + (relative[1] === '-' ? -1 : 1) * Number(relative[2]) * units[relative[3]!]!;
        if (relative[3] === 'd' || relative[3] === 'w') time = Math.floor(time / 86400000) * 86400000 + (end ? 86399000 : 0);
    } else if (/^\d+$/.test(input)) {
        time = Number(input) * (input.length <= 10 ? 1000 : 1);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        time = Date.parse(`${input}T${end ? '23:59:59' : '00:00:00'}Z`);
        if (Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) !== input) invalid('Invalid calendar date.');
    } else time = Date.parse(input);
    if (!Number.isFinite(time) || !Number.isFinite(new Date(time).getTime())) invalid('Use an ISO date, timestamp, or signed relative minute/hour/day/week offset.');
    return Math.floor(time / 1000) * 1000;
}
function iso(value: number): string { return new Date(value).toISOString().replace('.000Z', 'Z'); }
function range(value: unknown): JsonObject {
    const [first, last = ''] = String(value).split(',', 2).map(item => item.trim());
    const start = first ? timestamp(first) : undefined, end = last ? timestamp(last, true) : undefined;
    if (start !== undefined && end !== undefined && start > end) invalid('Start time must not be later than end time.');
    return { ...(start !== undefined ? { start_time: iso(start) } : {}), ...(end !== undefined ? { end_time: iso(end) } : {}) };
}
export function queryRequest(action: string, args: JsonObject): ApiRequest {
    const query: JsonObject = args['page-token'] ? { page_token: args['page-token'] } : {};
    if (action === 'get-my-tasks' || action === 'get-related-tasks') {
        Object.assign(query, { user_id_type: 'open_id', page_size: action === 'get-my-tasks' ? 50 : 100 });
        if (action === 'get-my-tasks') {
            query.type = 'my_tasks';
            if (args.complete !== undefined) query.completed = String(args.complete);
            const start = args['due-start'] ? timestamp(args['due-start']) : undefined;
            const end = args['due-end'] ? timestamp(args['due-end'], true) : undefined;
            if (start !== undefined && end !== undefined && start > end) invalid('Due start must not be later than due end.');
            if (args.created_at) timestamp(args.created_at);
        } else if (args['include-complete'] === false) query.completed = 'false';
        return { method: 'GET', path: `/open-apis/task/v2/${action === 'get-my-tasks' ? 'tasks' : 'task_v2/list_related_task'}`, query };
    }
    const filter: JsonObject = {};
    const tasklist = action === 'tasklist-search';
    for (const key of ['creator', 'assignee', 'follower']) {
        const values = csv(args[key]);
        if (values.length) filter[tasklist ? 'user_id' : `${key}_ids`] = values;
    }
    if (args.completed !== undefined) filter.is_completed = args.completed;
    const time = args[tasklist ? 'create-time' : 'due'];
    if (time) {
        const values = range(time);
        if (Object.keys(values).length) filter[tasklist ? 'create_time' : 'due_time'] = values;
    }
    if (!String(args.query ?? '').trim() && !Object.keys(filter).length) invalid('Provide a search query or at least one filter.');
    return { method: 'POST', path: `/open-apis/task/v2/${tasklist ? 'tasklists' : 'tasks'}/search`, query,
        body: { query: args.query ?? '', ...(Object.keys(filter).length ? { filter } : {}) } };
}
function url(value: unknown): string { return String(value ?? '').split('&')[0]!; }
function dateField(output: JsonObject, target: string, value: unknown, pretty = false) {
    if (typeof value !== 'string' || !/^-?\d+$/.test(value) || (pretty && value === '0')) return;
    const time = Number(value);
    if (Number.isFinite(new Date(time).getTime())) output[target] = pretty ? iso(time).replace('T', ' ').replace('Z', '') : iso(time);
}
function pick(output: JsonObject, task: JsonObject, fields: string[]) {
    for (const field of fields) if (Object.hasOwn(task, field)) output[field] = task[field];
}
export function taskOutput(task: JsonObject, action: string): JsonObject {
    const out: JsonObject = { guid: task.guid ?? null, summary: task.summary ?? null, url: url(task.url) };
    if (action === 'get-related-tasks') {
        for (const field of ['description', 'status', 'source', 'mode', 'subtask_count', 'tasklists']) out[field] = task[field] ?? null;
        pick(out, task, ['creator', 'members', 'start', 'due']);
    } else pick(out, task, ['members', 'start', ...(action === 'search' ? ['status'] : [])]);
    const pretty = action !== 'get-my-tasks';
    dateField(out, 'created_at', task.created_at, pretty);
    if (action === 'get-my-tasks') out.completed = typeof task.completed_at === 'string' && task.completed_at !== '0' && /^-?\d+$/.test(task.completed_at);
    if (task.completed_at !== '0') dateField(out, 'completed_at', task.completed_at, pretty);
    if (action === 'search') dateField(out, 'updated_at', task.updated_at, true);
    if (action !== 'get-related-tasks' && task.due) dateField(out, 'due_at', task.due.timestamp, pretty);
    return out;
}
function finish(state: JsonObject) {
    let items: JsonObject[] = state.items;
    const args: JsonObject = state.args;
    if (state.action === 'get-my-tasks') {
        const bounds = state.bounds;
        items = items.filter(item => (!bounds.created || Number(item.created_at ?? 0) >= bounds.created) &&
            (!(bounds.start || bounds.end) || (item.due && (!bounds.start || Number(item.due.timestamp ?? 0) >= bounds.start) && (!bounds.end || Number(item.due.timestamp ?? 0) <= bounds.end))));
        if (args.query) {
            const exact = items.filter(item => item.summary === args.query);
            items = exact.length ? exact : items.filter(item => String(item.summary ?? '').includes(args.query));
        }
    }
    if (state.action === 'get-related-tasks') items = items.filter(item =>
        (!args['created-by-me'] || item.creator?.id === state.user) &&
        (!args['followed-by-me'] || (Array.isArray(item.members) && item.members.some((member: JsonObject) => member.id === state.user && String(member.role).toLowerCase() === 'follower'))));
    if (state.action.startsWith('get-')) items = items.map(item => taskOutput(item, state.action));
    return { done: true as const, output: { items, page_token: state.token ?? '', has_more: state.more === true, ...(state.notice ? { notice: state.notice } : {}) } };
}
export function queryProgram(): WorkflowProgram {
    return { id: 'task-query', version: 1, domain: 'task', risk: 'read', identities: ['user'],
        step: async (input, context) => {
            const state: JsonObject = input;
            const args: JsonObject = state.args;
            if (state.phase === 'start') {
                const request = queryRequest(state.action, args);
                const limit = args['page-all'] ? 40 : Math.min(40, Number(args['page-limit']) > 0 ? Number(args['page-limit']) : 20);
                return { done: false, state: { ...state, request, limit, pages: 0, items: [], raw: [], phase: state.action === 'get-related-tasks' && (args['created-by-me'] || args['followed-by-me']) ? 'user' : 'page',
                    bounds: { created: args.created_at ? timestamp(args.created_at) : 0, start: args['due-start'] ? timestamp(args['due-start']) : 0, end: args['due-end'] ? timestamp(args['due-end'], true) : 0 } } };
            }
            if (state.phase === 'user') {
                const user = await context.lark.request({ method: 'GET', path: '/open-apis/authen/v1/user_info' });
                if (!user.open_id) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Current user response has no open_id.');
                return { done: false, state: { ...state, user: user.open_id, phase: 'page' } };
            }
            if (state.phase === 'page') {
                const request: ApiRequest = { ...state.request, query: { ...state.request.query, ...(state.token ? { page_token: state.token } : {}) } };
                const data: JsonObject = await context.lark.request(request);
                const page = (Array.isArray(data.items) ? data.items : []).filter((item: unknown) => item && typeof item === 'object' && !Array.isArray(item));
                const search = state.action === 'search' || state.action === 'tasklist-search';
                const next = { ...state, pages: state.pages + 1, token: data.page_token ?? '', more: data.has_more === true, notice: state.notice || data.notice || '',
                    items: search ? state.items : [...state.items, ...page], raw: search ? [...state.raw, ...page] : [] };
                if (next.more && next.token && next.pages < state.limit) return { done: false, state: next };
                return search ? { done: false, state: { ...next, phase: 'detail', index: 0 } } : finish(next);
            }
            if (state.phase === 'detail') {
                if (state.index >= state.raw.length) return finish(state);
                const item = state.raw[state.index], tasklist = state.action === 'tasklist-search';
                if (!item.id) return { done: false, state: { ...state, index: state.index + 1 } };
                let output: JsonObject;
                try {
                    const response: JsonObject = await context.lark.request({ method: 'GET', path: `/open-apis/task/v2/${tasklist ? 'tasklists' : 'tasks'}/${encodeURIComponent(item.id)}`, query: { user_id_type: 'open_id' } });
                    const detail = response[tasklist ? 'tasklist' : 'task'];
                    if (!detail) throw new Error('Missing detail');
                    output = tasklist ? { guid: detail.guid ?? null, name: detail.name ?? null, url: url(detail.url), creator: detail.creator ?? null } : taskOutput(detail, 'search');
                } catch {
                    output = tasklist ? { guid: item.id, name: `(unknown tasklist: ${item.id})` } : { guid: item.id, url: url(item.meta_data?.app_link) };
                }
                return { done: false, state: { ...state, index: state.index + 1, items: [...state.items, output] } };
            }
            throw new ServiceError('INVALID_WORKFLOW_STATE', 'Unknown task query phase.');
        },
    };
}

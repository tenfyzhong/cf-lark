import { ServiceError } from '../../domain/errors';
type JsonObject = Record<string, any>;
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram } from '../../ports/workflows';
import { csv, invalid, timestamp } from './query';
const base = '/open-apis/task/v2';
const query = { user_id_type: 'open_id' };
export function guid(value: unknown, strict = false): string {
    const text = String(value ?? '').trim();
    if (!text) invalid('A resource identifier is required.');
    if (/^https?:\/\//i.test(text)) {
        try { const id = new URL(text).searchParams.get('guid')?.trim(); if (id) return id; } catch { /* Report one consistent validation error. */ }
        invalid('The resource applink must contain a nonblank guid query parameter.');
    }
    if (strict && /^t\d+$/.test(text)) invalid('Task display numbers are not OpenAPI GUIDs.');
    return text;
}
function json(value: unknown, array = false): any {
    let parsed = value ?? (array ? [] : {});
    if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { invalid('data must contain valid JSON.'); } }
    if (array ? !Array.isArray(parsed) || parsed.some((item: unknown) => !item || typeof item !== 'object' || Array.isArray(item)) : !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalid(`data must be a JSON ${array ? 'array of objects' : 'object'}.`);
    return structuredClone(parsed);
}
function member(id: string, role: string): JsonObject { return { id, role, type: role === 'editor' ? 'user' : id.trim().startsWith('cli_') ? 'app' : 'user' }; }
function members(ids: string[], role: string): JsonObject { return { members: ids.map(id => member(id, role)) }; }
function body(args: JsonObject, create: boolean): JsonObject {
    const task = json(args.data || undefined);
    for (const field of ['summary', 'description']) if (args[field]) task[field] = args[field];
    if (args.due) task.due = { timestamp: String(timestamp(args.due)), is_all_day: /^\d{4}-\d{2}-\d{2}$/.test(args.due.trim()) || /^\+\d+[dw]$/.test(args.due.trim()) };
    if (create) {
        const assigned = ['assignee', 'follower'].filter(role => args[role]).map(role => member(args[role], role));
        if (assigned.length) task.members = assigned;
        if (args['tasklist-id']) task.tasklists = [{ tasklist_guid: guid(args['tasklist-id']) }];
        if (args['idempotency-key']) task.client_token = args['idempotency-key'];
        if (typeof task.summary !== 'string' || !task.summary.trim()) invalid('Task summary is required.');
        return task;
    }
    const fields = Object.keys(task);
    if (!fields.length) invalid('At least one update field is required.');
    return { task, update_fields: fields };
}
function req(method: ApiRequest['method'], path: string, body?: JsonObject): ApiRequest { return { method, path: `${base}/${path}`, query, ...(body ? { body } : {}) }; }
function taskResult(task: JsonObject = {}, id?: string): JsonObject {
    const out: JsonObject = { guid: id ?? task.guid ?? '', url: String(task.url ?? '').split('&')[0] };
    for (const key of ['summary', 'members', 'start', 'due', 'status']) if (Object.hasOwn(task, key)) out[key] = task[key];
    return out;
}
export function writePlan(action: string, args: JsonObject): JsonObject {
    const requests: ApiRequest[] = [];
    let id = '', data: JsonObject[] = [], fields: string[] = [];
    if (action === 'create') requests.push(req('POST', 'tasks', body(args, true)));
    else if (action === 'tasklist-create') {
        if (!String(args.name ?? '').trim()) invalid('Tasklist name is required.');
        data = json(args.data || undefined, true);
        requests.push(req('POST', 'tasklists', { name: args.name, ...(args.member ? members(csv(args.member), 'editor') : {}) }));
    } else if (action === 'tasklist-members') {
        id = guid(args['tasklist-id']);
        if (args.set && (args.add || args.remove)) invalid('set cannot be combined with add or remove.');
        if (args.set || (!args.add && !args.remove)) requests.push(req('GET', `tasklists/${encodeURIComponent(id)}`));
        else for (const operation of ['add', 'remove']) if (args[operation]) requests.push(req('POST', `tasklists/${encodeURIComponent(id)}/${operation}_members`, members(csv(args[operation]), 'editor')));
    } else if (action === 'update') {
        const ids = csv(args['task-id']).map(value => guid(value, true));
        if (!ids.length) invalid('At least one task GUID is required.');
        const value = body(args, false); fields = value.update_fields;
        for (const target of ids) requests.push(req('PATCH', `tasks/${encodeURIComponent(target)}`, value));
    } else if (action === 'tasklist-task-add') {
        id = guid(args['tasklist-id']);
        const ids = csv(args['task-id']); if (!ids.length) invalid('At least one task ID is required.');
        for (const target of ids) requests.push(req('POST', `tasks/${encodeURIComponent(target)}/add_tasklist`, { tasklist_guid: id, ...(String(args['section-guid'] ?? '').trim() ? { section_guid: args['section-guid'].trim() } : {}) }));
    } else {
        id = guid(args['task-id'], action === 'complete');
        const path = `tasks/${encodeURIComponent(id)}`;
        if (action === 'complete') requests.push(req('GET', path));
        else if (action === 'reopen') requests.push(req('PATCH', path, { task: { completed_at: '0' }, update_fields: ['completed_at'] }));
        else if (action === 'set-ancestor') requests.push(req('POST', `${path}/set_ancestor_task`, args['ancestor-id'] ? { ancestor_guid: args['ancestor-id'] } : {}));
        else if (action === 'comment') {
            if (!String(args.content ?? '').trim()) invalid('Comment content is required.');
            requests.push(req('POST', 'comments', { content: args.content, resource_id: id, resource_type: 'task' }));
        } else if (action === 'assign' || action === 'followers') {
            if (!args.add && !args.remove) invalid('Provide add or remove members.');
            for (const operation of ['add', 'remove']) if (args[operation]) requests.push(req('POST', `${path}/${operation}_members`, { ...members(csv(args[operation]), action === 'assign' ? 'assignee' : 'follower'), ...(operation === 'add' && args['idempotency-key'] ? { client_token: args['idempotency-key'] } : {}) }));
        } else if (action === 'reminder') {
            if (Boolean(args.set) === (args.remove === true)) invalid('Provide exactly one of set or remove.');
            if (args.set && !/^[+-]?\d+[mhd]?$/.test(args.set)) invalid('Reminder offset must be minutes or an integer with m, h, or d.');
            requests.push(req('GET', path));
        } else invalid('Unknown task write shortcut.');
    }
    return { requests, id, data, fields };
}
function failure(error: unknown): JsonObject {
    if (!(error instanceof ServiceError) || error.code === 'OUTCOME_UNCERTAIN') throw error;
    return { type: error.code, code: error.details?.upstreamCode ?? error.code, message: error.message };
}
function result(state: JsonObject): JsonObject {
    const action = state.action, data = state.last ?? {}, task = data.task ?? {};
    if (action === 'comment') return { id: data.comment?.id ?? '' };
    if (action === 'set-ancestor') return { ok: true, data: { guid: state.id } };
    if (action === 'update') return { updated_fields: state.fields, tasks: state.success };
    if (action === 'tasklist-create') return { ...(state.failed.length ? { ok: false } : {}), guid: state.createdList.guid ?? '', url: String(state.createdList.url ?? '').split('&')[0], created_tasks: state.success, failed_tasks: state.failed };
    if (action === 'tasklist-task-add') return { ...(state.failed.length ? { ok: false } : {}), successful_tasks: state.success, failed_tasks: state.failed, tasklist_guid: state.id };
    if (action === 'tasklist-members') {
        const list = data.tasklist ?? {};
        return { guid: state.id, url: String(list.url ?? '').split('&')[0], ...(!state.args.set && !state.args.add && !state.args.remove ? { name: list.name ?? null, members: (list.members ?? []).map((item: JsonObject) => ({ id: item.id ?? null, role: item.role ?? null, type: item.type ?? null })) } : {}) };
    }
    if (action === 'complete') return { ...taskResult(task), status: task.completed_at && task.completed_at !== '0' ? 'done' : 'todo', completed_at: task.completed_at ?? '', already_completed: state.already === true };
    if (action === 'reminder') return taskResult(state.original, state.id);
    return taskResult(task, ['assign', 'followers'].includes(action) ? state.id : undefined);
}
export function writeProgram(): WorkflowProgram {
    return { id: 'task-write', version: 1, domain: 'task', risk: 'write', identities: ['user', 'bot'], step: async (input, context) => {
            const state: JsonObject = input;
        if (state.phase === 'start') return { done: false, state: { ...state, ...writePlan(state.action, state.args), phase: 'run', index: 0, success: [], failed: [], last: {} } };
        if (state.index >= state.requests.length) return { done: true, output: result(state) };
        const request: ApiRequest = state.requests[state.index];
        let response: JsonObject;
        try { response = await context.lark.request(request); }
        catch (error) {
            if (state.action !== 'tasklist-task-add' && !(state.action === 'tasklist-create' && state.index > 0)) throw error;
            const detail = failure(error);
            return { done: false, state: { ...state, index: state.index + 1, failed: [...state.failed, { ...detail, ...(state.action === 'tasklist-create' ? { index: state.index - 1, summary: (request.body as JsonObject | undefined)?.summary ?? '' } : { guid: decodeURIComponent(request.path.split('/').at(-2)!) }) }] } };
        }
        const next: JsonObject = { ...state, index: state.index + 1, last: response };
        if (state.action === 'complete' && state.index === 0) {
            const completed = response.task?.completed_at;
            next.already = Boolean(completed && completed !== '0');
            if (!next.already) next.requests = [...state.requests, req('PATCH', `tasks/${encodeURIComponent(state.id)}`, { task: { completed_at: String(Math.floor(Date.now() / 1000) * 1000) }, update_fields: ['completed_at'] })];
        } else if (state.action === 'reminder' && state.index === 0) {
            next.original = response.task ?? {};
            const ids = (next.original.reminders ?? []).filter((item: JsonObject) => typeof item.id === 'string').map((item: JsonObject) => item.id);
            next.requests = [...state.requests];
            if (ids.length) next.requests.push(req('POST', `tasks/${encodeURIComponent(state.id)}/remove_reminders`, { reminder_ids: ids }));
            if (state.args.set) {
                const match = /^([+-]?\d+)([mhd]?)$/.exec(state.args.set)!;
                const minutes = Number(match[1]) * (match[2] === 'h' ? 60 : match[2] === 'd' ? 1440 : 1);
                next.requests.push(req('POST', `tasks/${encodeURIComponent(state.id)}/add_reminders`, { reminders: [{ relative_fire_minute: minutes }] }));
            }
        } else if (state.action === 'tasklist-members' && state.index === 0 && state.args.set) {
            const existing = (response.tasklist?.members ?? []).map((item: JsonObject) => item.id).filter((id: unknown) => typeof id === 'string');
            const target = csv(state.args.set);
            const add = target.filter(id => !existing.includes(id)), remove = existing.filter((id: string) => !target.includes(id));
            next.requests = [...state.requests];
            if (add.length) next.requests.push(req('POST', `tasklists/${encodeURIComponent(state.id)}/add_members`, members(add, 'editor')));
            if (remove.length) next.requests.push(req('POST', `tasklists/${encodeURIComponent(state.id)}/remove_members`, members(remove, 'editor')));
        } else if (state.action === 'tasklist-create' && state.index === 0) {
            if (!response.tasklist?.guid) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Created tasklist response has no GUID.');
            next.createdList = response.tasklist;
            next.requests = [...state.requests, ...state.data.map((input: JsonObject) => {
                const task: JsonObject = { ...input, tasklists: [{ tasklist_guid: response.tasklist.guid }] };
                if (typeof task.assignee === 'string') { task.members = [{ id: task.assignee, role: 'assignee', type: 'user' }]; delete task.assignee; }
                return req('POST', 'tasks', task);
            })];
        } else if (['update', 'tasklist-create', 'tasklist-task-add'].includes(state.action) && response.task) {
            const value = taskResult(response.task);
            if (state.action === 'update') value.confirmed = Object.fromEntries(state.fields.filter((field: string) => Object.hasOwn(response.task, field)).map((field: string) => [field, response.task[field]]));
            next.success = [...state.success, value];
        }
        return { done: false, state: next };
    } };
}

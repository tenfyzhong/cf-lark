import { imagePlan } from './image';
import { batchPlan } from './batch';
import { detailPlan } from './details';
import type { WorkflowRunner } from '../../ports/workflows';
import { editPlan } from './workflows';
import { ServiceError } from '../../domain/errors';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { okrDefinitions } from './definitions';
import { choice, comment, content, id, invalid, progress, simple, threads, time, toV1, type Data } from './content';
function prepare(action: string, args: Data): ApiRequest {
    const style = choice(args.style, ['simple', 'richtext'], 'simple');
    const user = choice(args['user-id-type'], ['open_id', 'union_id', 'user_id', ...(action.startsWith('comment-') ? ['user_key'] : [])], 'open_id');
    const query: Data = { user_id_type: user };
    const req = (method: ApiRequest['method'], path: string, body?: Data): ApiRequest => ({ method, path: `/open-apis/okr/${path}`, query, ...(body ? { body } : {}) });
    if (action.endsWith('-list')) {
        const size = args['page-size'] ?? 100; if (!Number.isInteger(size) || size < 1 || size > 100) invalid('page-size must be between 1 and 100.');
        query.page_size = size; if (args['page-token']) query.page_token = args['page-token'];
    }
    if (action === 'cycle-list') {
        if (!String(args['user-id'] ?? '').trim()) invalid('user-id is required.');
        query.user_id = args['user-id']; if (args['time-range']) cycleRange(args['time-range']);
        return req('GET', 'v2/cycles');
    }
    if (action === 'create' || action === 'patch') {
        const level = choice(args.level, ['objective', 'key-result']);
        if (level !== 'objective' && (args.notes || args['category-id'])) invalid('Notes and categories are objective-only.');
        const body: Data = {};
        if (action === 'create' || args.content) body.content = content(args.content, style, action === 'create');
        if (args.notes) body.notes = content(args.notes, style, action === 'create');
        if (args['category-id']) body.category_id = id(args['category-id']);
        if (action === 'create') {
            const parent = id(args[level === 'objective' ? 'cycle-id' : 'objective-id']);
            query[level === 'objective' ? 'cycle_id' : 'objective_id'] = parent;
            return req('POST', level === 'objective' ? `v2/cycles/${parent}/objectives` : `v2/objectives/${parent}/key_results`, body);
        }
        if (args.score !== undefined && args.score !== '') { const value = Number(args.score); if (!Number.isFinite(value) || value < 0 || value > 1 || Math.abs(value * 10 - Math.round(value * 10)) > 1e-10) invalid('score must be between zero and one with at most one decimal.'); body.score = value; }
        if (args.deadline) { id(args.deadline); if (BigInt(args.deadline) < 1000000000000n) invalid('deadline must use milliseconds.'); body.deadline = args.deadline; }
        if (!Object.keys(body).length) invalid('At least one editable field is required.');
        return req('PATCH', `v2/${level === 'objective' ? 'objectives' : 'key_results'}/${id(args['target-id'])}`, body);
    }
    if (action.startsWith('progress-')) {
        if (action === 'progress-delete') return { method: 'DELETE', path: `/open-apis/okr/v1/progress_records/${id(args['progress-id'])}` };
        if (action === 'progress-get') return req('GET', `v1/progress_records/${id(args['progress-id'])}`);
        if (action === 'progress-list') {
            const type = choice(args['target-type'], ['objective', 'key_result']);
            query.department_id_type = choice(args['department-id-type'], ['department_id', 'open_department_id'], 'open_department_id');
            return req('GET', `v2/${type === 'objective' ? 'objectives' : 'key_results'}/${id(args['target-id'])}/progresses`);
        }
        const body: Data = { content: toV1(content(args.content, style)) };
        const percent = args['progress-percent'];
        if (args['progress-status'] && (percent === undefined || percent === '')) invalid('progress-status requires progress-percent.');
        if (percent !== undefined && percent !== '') {
            const number = Number(percent); if (!Number.isFinite(number) || Math.abs(number) > 99999999999) invalid('progress-percent is out of range.');
            body.progress_rate = { percent: number };
            if (args['progress-status']) body.progress_rate.status = ['normal', 'overdue', 'done'].indexOf(choice(args['progress-status'], ['normal', 'overdue', 'done']));
        }
        if (action === 'progress-update') return req('PUT', `v1/progress_records/${id(args['progress-id'])}`, body);
        body.target_id = id(args['target-id']); body.target_type = choice(args['target-type'], ['objective', 'key_result']) === 'objective' ? 2 : 3;
        body.source_title = args['source-title'] || 'created by lark-cli'; body.source_url = args['source-url'] || 'https://open.feishu.cn/app';
        return req('POST', 'v1/progress_records/', body);
    }
    if (action === 'comment-list' || action === 'comment-create') {
        const target = { target_type: choice(args['target-type'], ['cycle', 'progress', 'objective', 'key_result']), target_id: id(args['target-id']) };
        if (action === 'comment-list') { Object.assign(query, target); return req('GET', 'v2/comments'); }
        const selected = args['selected-text'], all = args['select-all'] === true, reference = args['ref-comment-id'];
        if ([Boolean(selected), all, Boolean(reference)].filter(Boolean).length > 1) invalid('Selection text, select-all, and ref-comment-id are mutually exclusive.');
        if (['objective', 'key_result'].includes(target.target_type)) { if (!selected && !all && !reference) invalid('Objective comments require a selection or reply target.'); }
        else if (selected || all) invalid('Selections only apply to objectives and key results.');
        const block = content(args.content, style), body: Data = { target, content: block };
        if (selected) body.selected_text = selected;
        if (all) body.selected_text = '*'.repeat([...simple(block).text].length);
        if (reference) body.ref_comment_id = id(reference);
        return req('POST', 'v2/comments', body);
    }
    const target = id(args['comment-id']);
    if (action === 'comment-delete') return { method: 'DELETE', path: `/open-apis/okr/v2/comments/${target}` };
    if (action === 'comment-get') return req('GET', `v2/comments/${target}`);
    if (action === 'comment-patch') return req('PATCH', `v2/comments/${target}`, { content: content(args.content, style) });
    return req('POST', `v2/comments/${target}/${action === 'comment-solve' ? 'solve' : 'reopen'}`);
}
function cycleRange(value: string): [number, number] {
    const match = /^(\d{4})-(0[1-9]|1[0-2])--(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
    if (!match) invalid('time-range must be YYYY-MM--YYYY-MM.');
    const first = Date.UTC(Number(match[1]), Number(match[2]) - 1), last = Date.UTC(Number(match[3]), Number(match[4])) - 1;
    if (first > last) invalid('time-range start must not exceed its end.'); return [first, last];
}
function output(action: string, args: Data, data: Data, request: ApiRequest): Data {
    const style = args.style ?? 'simple', page = { has_more: data.has_more === true, page_token: data.page_token ?? '' };
    if (action === 'cycle-list') {
        const bounds = args['time-range'] ? cycleRange(args['time-range']) : undefined;
        const items = (data.items ?? []).filter((item: Data) => !bounds || Number(item.start_time) <= bounds[1] && Number(item.end_time) >= bounds[0]);
        const convert = (item: Data) => ({ id: item.id ?? '', start_time: time(item.start_time), end_time: time(item.end_time), ...(item.cycle_status !== undefined ? { cycle_status: ['default', 'normal', 'invalid', 'hidden'][item.cycle_status] ?? '' } : {}) });
        const now = Date.now();
        return { cycles: items.map(convert), ...page, current_active_cycles: items.filter((item: Data) => {
            const start = Number(item.start_time), end = Number(item.end_time), annual = new Date(start); annual.setUTCFullYear(annual.getUTCFullYear() + 1); annual.setUTCDate(annual.getUTCDate() - 1);
            return start <= now && end >= now && [0, 1].includes(item.cycle_status) && annual.getTime() !== end;
        }).map(convert) };
    }
    if (action === 'create') {
        const key = args.level === 'objective' ? 'objective_id' : 'key_result_id';
        if (typeof data[key] !== 'string' || !data[key]) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', `Create response missing ${key}.`);
        return { level: args.level, ...(args.level === 'key-result' ? { objective_id: args['objective-id'] } : {}), [key]: data[key] };
    }
    if (action === 'patch') return { level: args.level, target_id: args['target-id'], patched: Object.fromEntries(['content', 'notes', 'score', 'deadline'].map(key => [key, Object.hasOwn(request.body ?? {}, key)])) };
    if (action === 'progress-delete') return { deleted: true, progress_id: args['progress-id'] };
    if (action === 'progress-list') return { progress_list: (data.items ?? []).map((item: Data) => progress(item, 'richtext', true)), ...page };
    if (action.startsWith('progress-')) return { progress: progress(data, style), style };
    if (action === 'comment-delete') return { deleted: true, comment_id: args['comment-id'] };
    if (action === 'comment-list') return { comments: threads(data.items ?? [], style), ...page, style };
    if (!data.comment || typeof data.comment !== 'object') throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Comment response missing comment.');
    return { comment: comment(data.comment, style), style };
}
export function okrCapabilities(workflows?: WorkflowRunner): Capability[] {
    return okrDefinitions.map(definition => { const action = definition.id.split('.+')[1]!;
        if (action === 'upload-image') return { definition, preview: async args => imagePlan(args), execute: async (args, context) => { imagePlan(args); if (!workflows) throw new ServiceError('CONFIGURATION_ERROR', 'Workflow runner is required.'); return workflows.start('okr-image', { args }, context.selection, context.grant); } };
        if (action === 'batch-create') return { definition, preview: async args => ({ objectives: batchPlan(args), continuation: 'Create objectives and key results sequentially; roll back known objectives on definite failure.' }), execute: async (args, context) => { batchPlan(args); if (!workflows) throw new ServiceError('CONFIGURATION_ERROR', 'Workflow runner is required.'); return workflows.start('okr-batch', { args, phase: 'start' }, context.selection, context.grant); } };
        if (['cycle-detail', 'comment-detail'].includes(action)) return { definition, preview: async args => ({ requests: [detailPlan(args)], continuation: 'Fetch paginated objectives, key results, and all requested related resources.' }), execute: async (args, context) => { detailPlan(args); if (!workflows) throw new ServiceError('CONFIGURATION_ERROR', 'Workflow runner is required.'); return workflows.start('okr-details', { action, args, phase: 'start' }, context.selection, context.grant); } };
        if (['reorder', 'weight', 'indicator-update'].includes(action)) return { definition, preview: async args => ({ requests: [editPlan(action, args).request], continuation: 'Read all relevant pages before applying the mutation.' }), execute: async (args, context) => { editPlan(action, args); if (!workflows) throw new ServiceError('CONFIGURATION_ERROR', 'Workflow runner is required.'); return workflows.start('okr-edit', { action, args, phase: 'start' }, context.selection, context.grant); } };
        return { definition,
        preview: async args => ({ requests: [prepare(action, args)] }),
        execute: async (args, context) => { const request = prepare(action, args); if (action === 'progress-create' && !args['source-url']) (request.body as Data).source_url = context.lark.brand === 'lark' ? 'https://open.larksuite.com/app' : 'https://open.feishu.cn/app'; return output(action, args, await context.lark.request(request), request); },
    }; });
}

import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactStore } from '../../ports/artifacts';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { minutesReadDefinitions } from './read-definitions';
const base = '/open-apis/minutes/v1/minutes';
const flags = ['summary', 'todo', 'chapter', 'keyword', 'transcript'];
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
const text = (args: JsonObject, key: string) => typeof args[key] === 'string' ? args[key].trim() : '';
export function minuteTokens(args: JsonObject): string[] {
    const tokens = text(args, 'minute-tokens').split(',').map(token => token.trim()).filter(Boolean);
    if (!tokens.length || tokens.length > 50 || tokens.some(token => !/^[a-z0-9]+$/.test(token))) invalid('Provide 1 to 50 lowercase alphanumeric minute-tokens.');
    for (const key of ['output', 'output-dir']) if (text(args, key).split(/[\\/]/).includes('..') || /[\x00-\x1f]/.test(text(args, key))) invalid('Output names cannot contain traversal or control characters.');
    return tokens;
}
export function meetingTime(value: string, end = false): string {
    if (!value) return '';
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const input = /^\d{10}$/.test(value) ? Number(value) * 1000 : dateOnly ? `${value}T${end ? '23:59:59' : '00:00:00'}Z` : value;
    const date = new Date(input);
    if (!Number.isFinite(date.getTime()) || (dateOnly && date.toISOString().slice(0, 10) !== value)) invalid('Invalid date or timestamp.');
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function search(args: JsonObject, self?: string): ApiRequest {
    if (args.query !== undefined && args.keyword !== undefined && args.query !== args.keyword) invalid('query and keyword aliases conflict.');
    const query = text(args, 'query') || text(args, 'keyword');
    if ([...query].length > 50) invalid('Search query cannot exceed 50 characters.');
    const size = Number(args['page-size'] ?? 15);
    if (!Number.isInteger(size) || size < 1 || size > 30) invalid('page-size must be between 1 and 30.');
    const start = meetingTime(text(args, 'start')), end = meetingTime(text(args, 'end'), true);
    if (start && end && start > end) invalid('start must not be after end.');
    const filter: JsonObject = {};
    for (const key of ['owner-ids', 'participant-ids']) {
        const ids = text(args, key).split(',').map(id => id.trim()).filter(Boolean);
        if (ids.some(id => id !== 'me' && !/^ou_\S+$/.test(id))) invalid(`${key} requires open_ids or me.`);
        if (ids.length) filter[key.replaceAll('-', '_')] = ids.map(id => id === 'me' ? self ?? '{current_user_open_id}' : id);
    }
    if (start || end) filter.create_time = { ...(start ? { start_time: start } : {}), ...(end ? { end_time: end } : {}) };
    if (!query && !Object.keys(filter).length) invalid('Provide at least one search filter.');
    return { method: 'POST', path: `${base}/search`, query: { page_size: String(size), ...(text(args, 'page-token') ? { page_token: text(args, 'page-token') } : {}) }, body: { ...(query ? { query } : {}), ...(Object.keys(filter).length ? { filter } : {}), sorter: 'create_time_desc' } };
}
export function minutesReadCapabilities(workflows: WorkflowRunner): Capability[] {
    return minutesReadDefinitions.map(definition => ({ definition,
        preview: async args => {
            if (definition.id.endsWith('search')) return { requests: [search(args)], ...(JSON.stringify(search(args)).includes('{current_user_open_id}') ? { resolveCurrentUser: true } : {}) };
            const tokens = minuteTokens(args);
            return { program: 'minutes-detail', minute_tokens: tokens, requests: [{ method: 'GET', path: `${base}/{minute_token}` }, ...(flags.some(flag => args[flag] === true) ? [{ method: 'GET', path: `${base}/{minute_token}/artifacts` }] : [])], output: 'Private grant-owned transcript artifacts.' };
        },
        execute: async (args, context) => {
            if (definition.id.endsWith('detail')) {
                minuteTokens(args);
                if (args.transcript === true) authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
                return workflows.start('minutes-detail', { args, phase: 'metadata', index: 0, results: [] }, context.selection, context.grant);
            }
            let request = search(args);
            if (JSON.stringify(request).includes('{current_user_open_id}')) {
                if (context.selection.identity !== 'user') invalid('me requires user identity.');
                const user = await context.lark.request({ method: 'GET', path: '/open-apis/authen/v1/user_info' });
                if (typeof user.open_id !== 'string' || !user.open_id) throw new ServiceError('INVALID_RESPONSE', 'Current user did not return an open_id.', 502);
                request = search(args, user.open_id);
            }
            const data = await context.lark.request(request);
            const items = (Array.isArray(data.items) ? data.items : []).map(item => {
                if (!item || typeof item !== 'object') return item;
                const copy = { ...item };
                if (copy.meta_data && typeof copy.meta_data === 'object') { copy.meta_data = { ...copy.meta_data }; delete copy.meta_data.avatar; }
                return copy;
            });
            return { items, has_more: data.has_more ?? false, page_token: data.page_token ?? '', ...(data.notice ? { notice: data.notice } : {}) };
        },
    }));
}
export function minutesReadPrograms(artifacts: ArtifactStore): WorkflowProgram[] {
    return [{ id: 'minutes-detail', version: 1, domain: 'minutes', risk: 'read', identities: ['user', 'bot'], step: async (raw, context) => {
        const state = raw as { args: JsonObject; index: number; phase: string; results: JsonObject[]; current?: JsonObject; deadline?: number; nextPoll?: number };
        const tokens = minuteTokens(state.args), token = tokens[state.index];
        if (!token) return { done: true, output: { minutes: state.results, ...(state.results.every(item => item.error) ? { partial_failure: true } : {}) } };
        if (state.args.transcript === true) authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
        if (state.nextPoll && Date.now() < state.nextPoll) return { done: false, state: { ...state } };
        const current: JsonObject = state.current ?? { minute_token: token, title: '', note_id: '' };
        const finish = () => ({ done: false as const, state: { args: state.args, phase: 'metadata', index: state.index + 1, results: [...state.results, current] } });
        let data: JsonObject;
        try { data = await context.lark.request({ method: 'GET', path: `${base}/${token}${state.phase === 'artifacts' ? '/artifacts' : ''}` }); }
        catch (error) {
            if (!(error instanceof ServiceError)) throw error;
            if (error.details?.upstreamCode === 2091003) {
                const timeout = Number(state.args['wait-timeout-seconds']) > 0 ? Number(state.args['wait-timeout-seconds']) : 300;
                const interval = Number(state.args['wait-interval-seconds']) > 0 ? Number(state.args['wait-interval-seconds']) : 15;
                const deadline = state.deadline || Date.now() + timeout * 1000;
                if (state.args['wait-ready'] === true && Date.now() + interval * 1000 <= deadline) return { done: false, state: { ...state, deadline, nextPoll: Date.now() + interval * 1000 } };
                Object.assign(current, { status: 'processing', retryable: true, error: 'The minute is still being generated.', hint: 'Retry later with wait-ready.' });
            } else current.error = error.details?.upstreamCode === 2091005 ? 'No read permission. Request view permission explicitly before retrying.' : error.message;
            return finish();
        }
        if (state.phase === 'metadata') {
            if (!data.minute || typeof data.minute !== 'object') { current.error = 'Minute not found.'; return finish(); }
            const minute = data.minute as JsonObject;
            current.title = typeof minute.title === 'string' ? minute.title : ''; current.note_id = typeof minute.note_id === 'string' ? minute.note_id : '';
            return flags.some(flag => state.args[flag] === true) ? { done: false, state: { ...state, current, phase: 'artifacts', deadline: 0, nextPoll: 0 } } : finish();
        }
        const selected: JsonObject = {};
        if (state.args.summary === true) selected.summary = typeof data.summary === 'string' ? data.summary : '';
        for (const [flag, source, target] of [['todo', 'minute_todos', 'todos'], ['chapter', 'minute_chapters', 'chapters'], ['keyword', 'keywords', 'keywords']] as const) if (state.args[flag] === true) selected[target] = Array.isArray(data[source]) ? data[source] : [];
        if (state.args.transcript === true) {
            selected.transcript_file = '';
            if (typeof data.transcript === 'string' && data.transcript) {
                const blob = new Blob([data.transcript], { type: 'text/plain;charset=utf-8' });
                const artifact = await artifacts.upload(context.grant.id, blob.size, blob.stream());
                selected.transcript_file = artifact.id;
            }
        }
        current.artifacts = selected; return finish();
    } }];
}

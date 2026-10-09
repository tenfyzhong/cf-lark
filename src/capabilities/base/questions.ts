import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { questionDefinitions } from './question-definitions';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function parse(value: unknown): unknown { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { invalid('Invalid JSON array.'); } }
function prepare(name: string, args: JsonObject): ApiRequest {
    const definition = questionDefinitions.find(d => d.id === `base.+${name}`)!;
    for (const key of definition.inputSchema.required as string[]) if (!['questions', 'question-ids'].includes(key) && (typeof args[key] !== 'string' || !args[key].trim())) invalid(`${key} is required.`);
    if (name === 'form-detail') return { method: 'POST', path: '/open-apis/base/v3/bases/tables/forms/detail', body: { share_token: args['share-token'] } };
    const action = name.slice('form-questions-'.length);
    const request: ApiRequest = { method: action === 'list' ? 'GET' : action === 'create' ? 'POST' : action === 'update' ? 'PATCH' : 'DELETE', path: '/open-apis/base/v3/' + ['bases', args['base-token'], 'tables', args['table-id'], 'forms', args['form-id'], 'questions'].map(v => encodeURIComponent(String(v))).join('/') };
    if (action === 'list') return request;
    const value = parse(args[action === 'delete' ? 'question-ids' : 'questions']);
    if (action === 'update') {
        if (value !== null && !Array.isArray(value)) invalid('questions must be a JSON array.');
        request.body = { questions: value }; return request;
    }
    if (!Array.isArray(value) || value.length > 10) invalid('A JSON array with at most ten items is required.');
    if (action === 'delete') {
        if (!value.length || !value.every(id => typeof id === 'string' && id.trim())) invalid('question-ids requires at least one nonblank string.');
        request.body = { question_ids: value, ...(args['keep-field'] === true ? { keep_field: true } : {}) }; return request;
    }
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) invalid('Questions must be objects.');
        const question = item as JsonObject;
        for (const key of question.use_existing_field === true ? ['field_id'] : ['title', 'type']) if (typeof question[key] !== 'string' || !question[key].trim()) invalid(`${key} is required for this question.`);
    }
    request.body = { questions: value }; return request;
}
export function questionCapabilities(): Capability[] {
    return questionDefinitions.map(definition => {
        const name = definition.id.slice('base.+'.length);
        return { definition, preview: async args => ({ requests: [prepare(name, args)] }), execute: async (args, context) => {
            const request = prepare(name, args), data = await context.lark.request(request);
            if (name === 'form-detail') return data;
            if (name.endsWith('delete')) return { deleted: true, question_ids: (request.body as JsonObject).question_ids, keep_field: args['keep-field'] === true };
            const questions = name.endsWith('update') && Array.isArray(data.items) && data.items.length ? data.items : Array.isArray(data.questions) ? data.questions : null;
            return { questions, ...(name.endsWith('list') ? { total: data.total ?? null } : {}) };
        } };
    });
}

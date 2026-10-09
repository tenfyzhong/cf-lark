import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { minutesDefinitions } from './definitions';
const base = '/open-apis/minutes/v1/minutes';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function text(args: JsonObject, key: string): string { return typeof args[key] === 'string' ? args[key].trim() : ''; }
function resource(value: string): string { if (!value || /[\s/?#\\\x00-\x1f]/.test(value) || value === '.' || value === '..') invalid('A valid resource token is required.'); return value; }
function array(value: unknown): JsonObject[] {
    let items = value;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch { invalid('Expected a JSON array.'); } }
    if (!Array.isArray(items) || !items.length || items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) invalid('Expected a nonempty array of objects.');
    return items;
}
function todos(args: JsonObject): JsonObject[] {
    const batch = Object.hasOwn(args, 'todos');
    if (batch && ['operation', 'todo', 'is-done', 'todo-id'].some(key => Object.hasOwn(args, key))) invalid('Use either todos or single-item flags.');
    const items = batch ? array(args.todos) : [{ operation: args.operation, content: args.todo, todo_id: args['todo-id'], is_done: args['is-done'] }];
    return items.map(item => {
        const operation = text(item, 'operation'), content = text(item, 'content'), id = text(item, 'todo_id');
        if (!['add', 'update', 'delete'].includes(operation)) invalid('Todo operation must be add, update, or delete.');
        if (operation === 'add' && id) invalid('New todos cannot specify an ID.');
        if (operation !== 'add' && !id) invalid('Update and delete require todo_id.');
        if (operation === 'delete' ? !!content || item.is_done !== undefined : !content || typeof item.is_done !== 'boolean') invalid('Add/update require content and explicit is_done; delete accepts only todo_id.');
        return { operation, ...(operation !== 'add' ? { todo_id: id } : {}), ...(operation !== 'delete' ? { content, is_done: item.is_done } : {}) };
    });
}
function prepare(action: string, args: JsonObject): ApiRequest {
    if (action === 'upload') return { method: 'POST', path: `${base}/upload`, body: { file_token: resource(text(args, 'file-token')) } };
    const token = resource(text(args, 'minute-token')), path = `${base}/${encodeURIComponent(token)}`;
    if (action === 'update') {
        if (!text(args, 'topic')) invalid('topic must not be blank.');
        return { method: 'PATCH', path, body: { topic: args.topic } };
    }
    if (action === 'summary') {
        const summary = text(args, 'summary'); if (!summary) invalid('summary must not be blank.');
        return { method: 'PUT', path: `${path}/summary`, body: { summary } };
    }
    if (action === 'apply-permission') {
        const perm = text(args, 'perm'); if (!['view', 'edit'].includes(perm)) invalid('perm must be view or edit.');
        return { method: 'POST', path: `${path}/permissions/apply`, body: { perm } };
    }
    if (action === 'speaker-replace') {
        const speaker = text(args, 'from-speaker-id'), user = text(args, 'from-user-id'), target = text(args, 'to-user-id');
        if (!/^ou_\S+$/.test(target) || (!speaker && (!/^ou_\S+$/.test(user) || user === target))) invalid('Provide a source speaker ID or a distinct legacy open_id and a target open_id.');
        return { method: 'PUT', path: `${path}/transcript/speaker`, query: { user_id_type: 'open_id' }, body: { ...(speaker ? { from_speaker_id: speaker } : { from_user_id: user }), to_user_id: target } };
    }
    if (action === 'todo') return { method: 'POST', path: `${path}/todo`, body: { todo_items: todos(args) } };
    const seen = new Set<string>();
    const replacements = array(args['replace-words']).map(item => {
        const source = text(item, 'source_word');
        if (!source || seen.has(source) || (item.target_word !== undefined && typeof item.target_word !== 'string')) invalid('Replacement sources must be nonblank and unique; targets must be strings.');
        seen.add(source); return { source_word: source, target_word: item.target_word ?? '' };
    });
    return { method: 'PUT', path: `${path}/transcript/word`, body: { minute_token: token, replace_words: replacements } };
}
export function minutesCapabilities(): Capability[] {
    return minutesDefinitions.map(definition => {
        const action = definition.id.slice(9);
        return { definition, preview: async args => ({ requests: [prepare(action, args)] }), execute: async (args, context) => {
            const request = prepare(action, args);
            let data: JsonObject;
            try { data = await context.lark.request(request); } catch (error) {
                if (error instanceof ServiceError) {
                    const code = error.details?.upstreamCode;
                    if (code === 2091005) throw new ServiceError('PERMISSION_DENIED', 'No edit permission. Ask the owner for access; apply-permission is an explicit separate action.', 403, error.details);
                    if (code === 2091008) throw new ServiceError('QUOTA_EXCEEDED', 'Minutes ASR/AI quota is exhausted.', 429, error.details);
                    if (code === 2091110) throw new ServiceError('CONFLICT', 'The transcript is being edited. Wait for the other editor to finish.', 409, error.details);
                    if (code === 2091111 || code === 2091001) throw new ServiceError('NOT_FOUND', 'The requested transcript word or speaker was not found.', 404, error.details);
                }
                throw error;
            }
            const minute_token = text(args, 'minute-token');
            if (action === 'update') return { minute_token, topic: args.topic };
            if (action === 'summary') return { minute_token, updated: true };
            if (action === 'apply-permission') return { minute_token, perm: text(args, 'perm') };
            if (action === 'speaker-replace') return { minute_token, ...request.body as JsonObject };
            if (action === 'upload') {
                const minute_url = typeof data.minute_url === 'string' ? data.minute_url : '';
                let token = ''; try { token = new URL(minute_url).pathname.match(/\/minutes\/([^/]+)/)?.[1] ?? ''; } catch { /* The upstream may omit its URL. */ }
                return { minute_url, ...(token ? { minute_token: token } : {}) };
            }
            if (action === 'todo') {
                const items = (request.body as JsonObject).todo_items as JsonObject[];
                return { minute_token, count: items.length, updated: true, ...(items.length === 1 ? { operation: items[0]!.operation } : {}) };
            }
            if (!Array.isArray(data.replace_word_counts) || data.replace_word_counts.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new ServiceError('OUTCOME_UNCERTAIN', 'The request succeeded without per-word outcomes. Read the transcript before retrying; do not reprocess successful words.', 409);
            const counts = new Map(data.replace_word_counts.map(item => [text(item, 'source_word'), Number(item.replace_count)]));
            const replacements = (request.body as JsonObject).replace_words as JsonObject[];
            const succeeded: string[] = [], failed: string[] = [];
            for (const item of replacements) ((counts.get(String(item.source_word)) ?? 0) > 0 ? succeeded : failed).push(String(item.source_word));
            if (!succeeded.length) throw new ServiceError('NOT_FOUND', 'None of the source words were replaced. Confirm spelling, case, and spacing before retrying.', 404, { failed });
            return { minute_token, message: `Succeeded: ${succeeded.join(', ')}; Failed: ${failed.join(', ') || 'none'}. Do not reprocess words that already succeeded.` };
        } };
    });
}

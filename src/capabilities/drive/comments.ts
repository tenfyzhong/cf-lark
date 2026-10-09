import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { driveCommentDefinitions } from './comment-definitions';
import { enc, invalid, obj, resource, str, target } from './helpers';
import { reactionTypes } from './reactions';
const types = ['doc', 'docx', 'sheet', 'file', 'slides', 'bitable', 'apps'];
function elements(content: unknown, reply: boolean): JsonObject[] {
    let raw = content;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { invalid('content must be a JSON array of reply elements.'); } }
    if (!Array.isArray(raw) || !raw.length || (reply && raw.length > 100)) invalid('Reply elements must be a nonempty array within the endpoint limit.');
    let total = 0;
    return raw.map((value) => {
        const item = obj(value), type = str(item.type);
        if (type === 'text') {
            if (!str(item.text)) invalid('Text elements require nonblank text.');
            total += [...String(item.text)].length;
            if (total > 10000) invalid('Combined comment text exceeds 10000 Unicode code points.');
            return { type, text: String(item.text).replaceAll('<', '&lt;').replaceAll('>', '&gt;') };
        }
        if (type !== 'link' && type !== 'mention_user') invalid('Unsupported reply element type.');
        const text = item[type] || item.text;
        if (!str(text)) invalid(`${type} elements require a value.`);
        return { type, [type]: text };
    });
}
function anchor(args: JsonObject, type: string): JsonObject | undefined {
    const block = str(args['block-id']);
    if (args['full-comment'] === true && block) invalid('full-comment and block-id are mutually exclusive.');
    if (type === 'file') { if (block) invalid('File comments must be full-document comments.'); return { block_id: 'test' }; }
    if (type === 'doc' && block) invalid('Legacy documents do not support local comments.');
    if (type === 'sheet') {
        const match = block.match(/^([^!]+)!([A-Za-z]+)([1-9]\d*)$/);
        if (!match) invalid('Sheet comments require sheetId!cell.');
        let col = 0; for (const letter of match[2]!.toUpperCase()) col = col * 26 + letter.charCodeAt(0) - 64;
        return { block_id: match[1], sheet_col: col - 1, sheet_row: Number(match[3]) - 1 };
    }
    if (type === 'slides') { const index = block.indexOf('!'); if (index < 1 || !block.slice(index + 1).trim()) invalid('Slide comments require blockType!xmlId.'); return { block_id: block.slice(index + 1).trim(), slide_block_type: block.slice(0, index).trim() }; }
    if (type === 'bitable') { const parts = block.split('!').map((part) => part.trim()); if (parts.length !== 3 || parts.some((part) => !part)) invalid('Base comments require table!record!view.'); return { block_id: parts[0], base_record_id: parts[1], base_view_id: parts[2] }; }
    return block ? { block_id: block } : undefined;
}
function prepare(action: string, input: JsonObject) {
    const args = { ...input };
    if (args.url && args.token) invalid('Provide exactly one url or token.');
    const ref = target(action === 'add-comment' ? args.doc : args.url || args.token, args.type === 'base' ? 'bitable' : args.type, [...types.filter((type) => action !== 'add-comment' || type !== 'apps'), 'wiki']);
    for (const key of driveCommentDefinitions.find((item) => item.id === `drive.+${action}`)!.inputSchema.required as string[]) if (args[key] === undefined || args[key] === '') invalid(`${key} is required.`);
    for (const key of ['comment-id', 'reply-id']) if (args[key] !== undefined) resource(args[key], key);
    if (action === 'add-comment' || action === 'add-reply' || action === 'update-reply') args.elements = elements(args.content, action !== 'add-comment');
    if (action === 'add-comment' && ref.type !== 'wiki') anchor(args, ref.type);
    if (action.startsWith('list-')) {
        args['page-size'] ??= 50;
        if (!Number.isInteger(args['page-size']) || Number(args['page-size']) < 1 || Number(args['page-size']) > 100) invalid('page-size must be between 1 and 100.');
    }
    if (action === 'list-comments') {
        args['solved-status'] ??= 'false'; args['comment-scope'] ??= 'all';
        if (!['false', 'true', 'all'].includes(str(args['solved-status'])) || !['all', 'whole', 'partial'].includes(str(args['comment-scope']))) invalid('Invalid comment filter.');
    }
    if (action === 'batch-query-comments') {
        if (!Array.isArray(args['comment-ids']) || !args['comment-ids'].length || args['comment-ids'].length > 100) invalid('comment-ids requires 1 to 100 IDs.');
        args['comment-ids'] = [...new Set(args['comment-ids'].map((id) => resource(id, 'comment-id')))];
    }
    if (action === 'react-reply' && (!['add', 'delete'].includes(str(args.action)) || !reactionTypes.has(str(args.emoji)))) invalid('Invalid reaction action or case-sensitive emoji name.');
    return { args, ref };
}
function request(action: string, args: JsonObject, ref: { token: string; type: string }): ApiRequest {
    const base = `/open-apis/drive/v1/files/${enc(ref.token)}/comments`, query: JsonObject = { file_type: ref.type };
    if (action === 'add-comment') {
        const location = anchor(args, ref.type);
        return { method: 'POST', path: `/open-apis/drive/v1/files/${enc(ref.token)}/new_comments`, body: { file_type: ref.type, reply_elements: args.elements, ...(location ? { anchor: location } : {}) } };
    }
    if (action.startsWith('list-')) {
        query.page_size = args['page-size'];
        if (args['page-token']) query.page_token = args['page-token'];
        if (args['need-reaction']) query.need_reaction = true;
        if (action === 'list-comments') {
            if (args['solved-status'] !== 'all') query.is_solved = args['solved-status'] === 'true';
            if (args['comment-scope'] !== 'all') query.is_whole = args['comment-scope'] === 'whole';
            if (args['need-relation'] && ref.type === 'docx') query.need_relation = true;
        }
        return { method: 'GET', path: action === 'list-comments' ? base : `${base}/${enc(args['comment-id'])}/replies`, query };
    }
    if (action === 'batch-query-comments') return { method: 'POST', path: `${base}/batch_query`, query, body: { comment_ids: args['comment-ids'], ...(args['need-reaction'] ? { need_reaction: true } : {}), ...(args['need-relation'] && ref.type === 'docx' ? { need_relation: true } : {}) } };
    if (action === 'react-reply') return { method: 'POST', path: `/open-apis/drive/v2/files/${enc(ref.token)}/comments/reaction`, query, body: { action: args.action, reaction_type: args.emoji, reply_id: args['reply-id'] } };
    if (action === 'resolve-comment' || action === 'restore-comment') return { method: 'PATCH', path: `${base}/${enc(args['comment-id'])}`, query, body: { is_solved: action === 'resolve-comment' } };
    const path = `${base}/${enc(args['comment-id'])}/replies${action === 'add-reply' ? '' : `/${enc(args['reply-id'])}`}`;
    if (action === 'delete-reply') return { method: 'DELETE', path, query };
    const converted = (args.elements as JsonObject[]).map((item) => item.type === 'text' ? { type: 'text_run', text_run: { text: item.text } } : item.type === 'mention_user' ? { type: 'person', person: { user_id: item.mention_user } } : { type: 'docs_link', docs_link: { url: item.link } });
    return { method: action === 'add-reply' ? 'POST' : 'PUT', path, query, body: { content: { elements: converted } } };
}
export function driveCommentCapabilities(): Capability[] {
    return driveCommentDefinitions.map((definition) => {
        const action = definition.id.slice('drive.+'.length);
        return { definition,
            async preview(input) {
                const { args, ref } = prepare(action, input), requests: ApiRequest[] = [];
                if (ref.type === 'wiki') requests.push({ method: 'GET', path: '/open-apis/wiki/v2/spaces/node_by_token', query: { token: ref.token } });
                if (action === 'add-comment' && ref.type === 'file') requests.push({ method: 'POST', path: '/open-apis/drive/v1/metas/batch_query', body: { request_docs: [{ doc_token: ref.token, doc_type: 'file' }] } });
                if (ref.type !== 'wiki') requests.push(request(action, args, ref));
                return { requests, ...(ref.type === 'wiki' ? { next: 'Validate the resolved object type, then apply the comment operation to its obj_token.' } : {}) };
            },
            async execute(input, context) {
                const { args, ref } = prepare(action, input), wiki = ref.type === 'wiki' ? ref.token : '';
                if (wiki) {
                    const resolved = await context.lark.request({ method: 'GET', path: '/open-apis/wiki/v2/spaces/node_by_token', query: { token: wiki } }), node = obj(resolved.node);
                    if (node.obj_type === 'base') node.obj_type = 'bitable';
                    if (!str(node.obj_token) || !types.includes(str(node.obj_type)) || (action === 'add-comment' && node.obj_type === 'apps')) throw new ServiceError('INVALID_RESPONSE', 'Wiki did not resolve to a supported comment object.');
                    ref.token = str(node.obj_token); ref.type = str(node.obj_type);
                }
                let title = '', extension = '';
                if (action === 'add-comment') {
                    anchor(args, ref.type);
                    if (ref.type === 'file') {
                        const data = await context.lark.request({ method: 'POST', path: '/open-apis/drive/v1/metas/batch_query', body: { request_docs: [{ doc_token: ref.token, doc_type: 'file' }] } });
                        title = str(obj(Array.isArray(data.metas) ? data.metas[0] : {}).title); extension = title.slice(title.lastIndexOf('.')).toLowerCase();
                        if (!['.md', '.txt', '.json', '.csv', '.go', '.js', '.py', '.pptx', '.png', '.jpg', '.jpeg', '.zip', '.mp3', '.mp4'].includes(extension)) invalid('This binary file extension does not support comments.');
                    }
                }
                const data = await context.lark.request(request(action, args, ref));
                const output: JsonObject = { file_token: ref.token, file_type: ref.type, ...(wiki ? { wiki_token: wiki } : {}) };
                if (action === 'add-comment') {
                    const mode = ({ sheet: 'sheet', slides: 'slide_block', bitable: 'base_record' } as Record<string, string>)[ref.type] || (args['block-id'] ? 'local' : 'full');
                    const location = anchor(args, ref.type) || {};
                    const anchored = ref.type === 'sheet' ? { block_id: args['block-id'] } : ref.type === 'slides' ? { anchor_block_id: location.block_id, slide_block_type: location.slide_block_type } : ref.type === 'bitable' ? { base_block_id: location.block_id, base_record_id: location.base_record_id, base_view_id: location.base_view_id } : args['block-id'] ? { anchor_block_id: args['block-id'], selection_source: 'block_id' } : data.is_whole !== undefined ? { is_whole: data.is_whole } : {};
                    return { ...output, ...(data.comment_id !== undefined ? { comment_id: data.comment_id } : {}), ...(data.reply_id ? { reply_id: data.reply_id } : {}), ...(!['sheet', 'slides', 'bitable'].includes(ref.type) ? { doc_id: ref.token } : {}), ...(!['sheet', 'slides'].includes(ref.type) ? { resolved_by: wiki ? 'wiki' : ref.type === 'bitable' ? 'base' : ref.type } : {}), comment_mode: mode, ...anchored, ...(title ? { file_name: title, file_extension: extension } : {}), ...(data.created_at !== undefined || data.create_time !== undefined ? { created_at: data.created_at ?? data.create_time } : {}) };
                }
                if (args['comment-id']) output.comment_id = args['comment-id'];
                if (args['reply-id']) output.reply_id = args['reply-id'];
                if (action.startsWith('list-') || action === 'batch-query-comments') {
                    const items = Array.isArray(data.items) ? data.items : [];
                    return { ...output, items, count: items.length, ...(action.startsWith('list-') ? { has_more: data.has_more === true, page_token: str(data.page_token) } : {}) };
                }
                if (action === 'add-reply') {
                    const replies = obj(data.reply_list).replies;
                    const replyId = str(data.reply_id || obj(data.reply).reply_id || (Array.isArray(replies) ? obj(replies.find((item) => str(obj(item).reply_id))).reply_id : ''));
                    return { ...output, created: true, ...(replyId ? { reply_id: replyId } : {}) };
                }
                if (action === 'resolve-comment' || action === 'restore-comment') return { ...output, updated: true, action: action === 'resolve-comment' ? 'resolve' : 'restore', is_solved: action === 'resolve-comment' };
                if (action === 'react-reply') return { ...output, updated: true, action: args.action, reaction_type: args.emoji };
                return { ...output, [action === 'delete-reply' ? 'deleted' : 'updated']: true };
            },
        };
    });
}

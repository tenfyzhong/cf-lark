import { grantCurrentUser } from './commands';
import { ServiceError } from '../../domain/errors';
import type { JsonObject, Brand } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { driveMetadataDefinitions } from './metadata-definitions';
import { enc, invalid, obj, resource, str, target } from './helpers';
export function resourceUrl(type: string, token: string, brand: Brand = 'feishu') {
    const prefix = ({ folder: 'drive/folder', sheet: 'sheets', bitable: 'base', apps: 'page' } as Record<string, string>)[type] || type;
    return `https://www.${brand === 'lark' ? 'larksuite.com' : 'feishu.cn'}/${prefix}/${enc(token)}`;
}
function prepare(action: string, input: JsonObject) {
    const args = { ...input };
    for (const key of driveMetadataDefinitions.find((item) => item.id === `drive.+${action}`)!.inputSchema.required as string[]) if (!str(args[key])) invalid(`${key} is required.`);
    if (action.startsWith('version-')) {
        resource(args['file-token']);
        for (const key of ['version', 'cursor']) if (args[key] !== undefined && !/^\d{1,19}$/.test(str(args[key]))) invalid(`${key} must be a numeric string.`);
        args.limit ??= 20;
        if (action === 'version-history' && (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 200)) invalid('limit must be between 1 and 200.');
        return { args, ref: { token: str(args['file-token']), type: 'file' } };
    }
    if (action !== 'inspect' && args.url && args.token) invalid('Provide exactly one url or token.');
    const allowed = action === 'update-title' ? ['docx', 'sheet', 'bitable', 'slides', 'file', 'folder', 'wiki'] : ['doc', 'docx', 'sheet', 'bitable', 'slides', 'file', 'folder', 'wiki', 'mindnote'];
    const ref = target(args.url || args.token, args.type === 'base' ? 'bitable' : args.type, allowed);
    if (action === 'copy') {
        args.name = str(args.name);
        if (new TextEncoder().encode(String(args.name)).length > 256) invalid('Copy name must not exceed 256 UTF-8 bytes.');
        if (ref.type === 'folder') invalid('Folders cannot be copied with this command.');
        args['folder-token'] = str(args['folder-token']) === 'my_space' ? 'my_space' : target(args['folder-token'], 'folder', ['folder']).token;
        if (args.extra !== undefined && !Array.isArray(args.extra)) invalid('extra must be an array of key=value strings.');
        args.extras = (Array.isArray(args.extra) ? args.extra : []).map((value) => {
            const text = String(value), index = text.indexOf('='); if (index <= 0) invalid('extra requires key=value.'); return { key: text.slice(0, index), value: text.slice(index + 1) };
        });
    }
    if (action === 'update-title') {
        args.title = str(args.title); args['on-extension-mismatch'] ??= 'keep';
        if (!['keep', 'allow'].includes(str(args['on-extension-mismatch']))) invalid('Invalid extension mismatch policy.');
        if (ref.type !== 'file' && Object.hasOwn(input, 'on-extension-mismatch')) invalid('on-extension-mismatch is only valid for binary files.');
    }
    return { args, ref };
}
function meta(ref: { token: string; type: string }): ApiRequest { return { method: 'POST', path: '/open-apis/drive/v1/metas/batch_query', body: { request_docs: [{ doc_token: ref.token, doc_type: ref.type }] } }; }
function finalRequest(action: string, args: JsonObject, ref: { token: string; type: string }): ApiRequest {
    const path = `/open-apis/drive/v1/files/${enc(ref.token)}`;
    if (action === 'inspect') return meta(ref);
    if (action === 'copy') return { method: 'POST', path: `${path}/copy`, body: { name: args.name, type: ref.type, folder_token: args['folder-token'], ...((args.extras as unknown[]).length ? { extra: args.extras } : {}) } };
    if (action === 'update-title') return { method: 'PATCH', path, query: { type: ref.type }, body: { new_title: args.title } };
    if (action === 'version-history') return { method: 'GET', path: `${path}/history`, query: { only_tag: true, page_size: args.limit, ...(args.cursor ? { last_edit_time: args.cursor } : {}) } };
    return { method: 'POST', path: `${path}/${action === 'version-revert' ? 'revert' : 'version_del'}`, body: { version: args.version } };
}
export function driveMetadataCapabilities(): Capability[] {
    return driveMetadataDefinitions.map((definition) => {
        const action = definition.id.slice('drive.+'.length);
        return { definition,
            async preview(input) {
                const { args, ref } = prepare(action, input), requests: ApiRequest[] = [];
                if (ref.type === 'wiki' && action !== 'update-title') requests.push({ method: 'GET', path: '/open-apis/wiki/v2/spaces/node_by_token', query: { token: ref.token } });
                if (args['folder-token'] === 'my_space') requests.push({ method: 'GET', path: '/open-apis/drive/explorer/v2/root_folder/meta' });
                if (action === 'update-title' && ref.type === 'file' && args['on-extension-mismatch'] !== 'allow') requests.push(meta(ref));
                requests.push(finalRequest(action, args, ref));
                return { requests, ...(ref.type === 'wiki' && action !== 'update-title' ? { resolution: 'Replace the source token/type with the resolved Wiki obj_token/obj_type before the final request.' } : {}) };
            },
            async execute(input, context) {
                const { args, ref } = prepare(action, input); let wiki: JsonObject | undefined, previous = '', appended = '';
                if (ref.type === 'wiki' && action !== 'update-title') {
                    wiki = obj((await context.lark.request({ method: 'GET', path: '/open-apis/wiki/v2/spaces/node_by_token', query: { token: ref.token } })).node);
                    if (!str(wiki.obj_token) || !str(wiki.obj_type)) throw new ServiceError('INVALID_RESPONSE', 'Wiki lookup omitted the underlying object.');
                    wiki.node_token ||= ref.token; ref.token = resource(wiki.obj_token); ref.type = str(wiki.obj_type);
                    if (action === 'copy' && !['doc', 'docx', 'sheet', 'bitable', 'slides', 'file', 'mindnote'].includes(ref.type)) invalid('Wiki resolved to an unsupported copy type.');
                }
                if (args['folder-token'] === 'my_space') {
                    const root = await context.lark.request({ method: 'GET', path: '/open-apis/drive/explorer/v2/root_folder/meta' });
                    if (!str(root.token)) throw new ServiceError('INVALID_RESPONSE', 'Root folder lookup omitted token.'); args['folder-token'] = root.token;
                }
                if (action === 'update-title' && ref.type === 'file' && args['on-extension-mismatch'] !== 'allow') {
                    const data = await context.lark.request(meta(ref)); previous = str(obj(Array.isArray(data.metas) ? data.metas[0] : {}).title);
                    if (!previous) throw new ServiceError('INVALID_RESPONSE', 'Metadata omitted the current file title.');
                    const extension = (value: string) => value.lastIndexOf('.') > 0 ? value.slice(value.lastIndexOf('.')) : '';
                    const oldExt = extension(previous), newExt = extension(str(args.title));
                    if (oldExt && !newExt) { appended = oldExt; args.title = `${args.title}${oldExt}`; }
                    else if (oldExt.toLowerCase() !== newExt.toLowerCase()) invalid('The new title changes the file extension; use allow to opt in.');
                }
                const data = await context.lark.request(finalRequest(action, args, ref));
                if (action === 'copy') {
                    const file = obj(data.file);
                    if (!str(file.token)) throw new ServiceError('INVALID_RESPONSE', 'Copy succeeded but returned no file token.');
                    const permission = context.selection.identity === 'bot' ? await grantCurrentUser(context, str(file.token), str(file.type) || ref.type) : undefined;
                    return { ...(permission ? { permission_grant: permission } : {}), copied: true, source_file_token: ref.token, source_type: ref.type, folder_token: args['folder-token'], ...(wiki ? { source_wiki_token: wiki.node_token } : {}), ...(file.token ? { file_token: file.token, url: file.url || resourceUrl(str(file.type), str(file.token), context.lark.brand) } : {}), ...(file.type ? { file_type: file.type } : {}), ...(file.name ? { name: file.name } : {}) };
                }
                if (action === 'update-title') return { updated: true, file_token: ref.token, type: ref.type, title: args.title, url: resourceUrl(ref.type, ref.token, context.lark.brand), ...(previous ? { previous_title: previous } : {}), ...(appended ? { extension_appended: appended } : {}) };
                if (action === 'inspect') {
                    if (!Array.isArray(data.metas) || !data.metas.length) throw new ServiceError('INVALID_RESPONSE', 'Metadata lookup returned no document.');
                    return { input_url: args.url, type: ref.type, title: str(obj(data.metas[0]).title), token: ref.token, url: resourceUrl(ref.type, ref.token, context.lark.brand), ...(wiki ? { wiki_node: wiki } : {}) };
                }
                if (action === 'version-history') {
                    const items = Array.isArray(data.items) ? data.items.map(obj) : [], versions = items.filter((item) => typeof item.version === 'string' && item.version).map((item) => ({ version: item.version, name: str(item.name), edited_at: String(item.edit_time ?? ''), edited_by: str(item.edit_user_id), size_bytes: Math.trunc(Number(item.size ?? 0)), action_type: ({ 1: 'upload', 2: 'rename', 3: 'delete_version', 4: 'revert' } as Record<number, string>)[Number(item.type)] || `type_${Number(item.type ?? 0)}`, is_deleted: item.is_deleted === true, tag: Math.trunc(Number(item.tag ?? 0)) }));
                    const cursor = data.has_more === true && items.length ? String(items.at(-1)!.edit_time ?? '') : '';
                    return { versions, has_more: data.has_more === true, ...(cursor ? { next_cursor: cursor } : {}) };
                }
                return {};
            },
        };
    });
}

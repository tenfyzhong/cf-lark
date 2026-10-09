import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { CommandContext } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram } from '../../ports/workflows';
const base = '/open-apis/wiki/v2/spaces';
const str = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const obj = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const enc = (value: unknown) => encodeURIComponent(str(value));
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function requireResponse(value: unknown, field: string): string { const result = str(value); if (!result) throw new ServiceError('INVALID_RESPONSE', `Wiki response omitted ${field}.`); return result; }
function token(value: unknown): { value: string; type?: string } {
    const raw = str(value);
    if (!raw) invalid('node-token is required.');
    if (raw.includes('://')) {
        let url: URL; try { url = new URL(raw); } catch { return invalid('Invalid resource URL.'); }
        const match = url.pathname.match(/^\/(wiki|docx|doc|sheets|base|mindnote|slides|file)\/([^/]+)/);
        if (!match) invalid('Unsupported resource URL.');
        let decoded: string; try { decoded = decodeURIComponent(match[2]!); } catch { return invalid('Invalid resource token encoding.'); }
        if (!decoded || decoded === '.' || decoded === '..' || /[\s/?#\x00-\x1f]/.test(decoded)) invalid('URL contains an unsafe resource token.');
        return { value: decoded, type: ({ sheets: 'sheet', base: 'bitable' } as Record<string, string>)[match[1]!] ?? match[1]! };
    }
    if (raw === '.' || raw === '..' || /[\s/?#\x00-\x1f]/.test(raw)) invalid('Expected a plain resource token or complete URL.');
    return { value: raw };
}
const types = ['wiki', 'doc', 'docx', 'sheet', 'bitable', 'mindnote', 'slides', 'file'];
export function normalizeNode(action: string, args: JsonObject, identity: string): JsonObject {
    if (action === 'node-get' || action === 'node-delete') {
        if (action === 'node-get' && args.token && args['node-token'] && args.token !== args['node-token']) invalid('token and node-token disagree.');
        const parsed = token(args['node-token'] || args.token); args['node-token'] = parsed.value;
        if (action === 'node-delete') {
            if (parsed.type && args['obj-type'] && parsed.type !== args['obj-type']) invalid('obj-type contradicts the resource URL.');
            args['obj-type'] ||= parsed.type;
            if (!types.includes(str(args['obj-type']))) invalid('Raw deletion tokens require a supported obj-type.');
            args['include-children'] ??= true;
        }
    }
    if (action === 'node-create') {
        args['node-type'] ??= 'origin'; args['obj-type'] ??= 'docx';
        if (!['origin', 'shortcut'].includes(str(args['node-type'])) || !types.slice(1).includes(str(args['obj-type']))) invalid('Unsupported node or object type.');
        if ((args['node-type'] === 'shortcut') !== Boolean(args['origin-node-token'])) invalid('origin-node-token is required only for shortcut nodes.');
        if (args['node-type'] === 'origin' && args['obj-type'] === 'file') invalid('File objects require shortcut nodes.');
        if (identity === 'bot' && !args['space-id'] && !args['parent-node-token']) invalid('Bot creation requires an explicit space or parent.');
    }
    if (action === 'node-copy' && Boolean(args['target-space-id']) === Boolean(args['target-parent-node-token'])) invalid('Provide exactly one copy destination.');
    if (action === 'move') {
        if (args['node-token']) {
            if (args['obj-token'] || args['obj-type'] || args.apply) invalid('Node move cannot use document move flags.');
            if (!args['target-parent-token'] && !args['target-space-id']) invalid('A move destination is required.');
        } else {
            if (args['source-space-id']) invalid('source-space-id is only valid for node moves.');
            if (!args['obj-token'] || !types.slice(1).includes(str(args['obj-type'])) || !args['target-space-id']) invalid('Document moves require obj-token, obj-type and target-space-id.');
        }
    }
    for (const key of ['node-token', 'parent-node-token', 'origin-node-token', 'target-parent-node-token', 'target-parent-token', 'source-space-id', 'target-space-id', 'folder-token', 'obj-token']) {
        if (args[key] && (str(args[key]) === '.' || str(args[key]) === '..' || /[\s/?#\x00-\x1f]/.test(str(args[key])))) invalid(`${key} must be a plain resource ID.`);
    }
    return args;
}
function lookup(value: unknown): ApiRequest { return { method: 'GET', path: `${base}/node_by_token`, query: { token: value } }; }
function mutation(action: string, args: JsonObject, state: JsonObject): ApiRequest {
    const space = state.space || args['space-id'], source = state.sourceSpace || args['source-space-id'];
    if (action === 'node-create') return { method: 'POST', path: `${base}/${enc(space)}/nodes`, body: {
        obj_type: args['obj-type'], node_type: args['node-type'], ...(args.title ? { title: args.title } : {}),
        ...(args['origin-node-token'] ? { origin_node_token: args['origin-node-token'] } : {}), ...(state.parentToken ? { parent_node_token: state.parentToken } : {}),
    } };
    if (action === 'node-copy') return { method: 'POST', path: `${base}/${enc(space)}/nodes/${enc(args['node-token'])}/copy`, body: {
        ...(args['target-space-id'] ? { target_space_id: args['target-space-id'] } : {}), ...(args['target-parent-node-token'] ? { target_parent_token: args['target-parent-node-token'] } : {}), ...(args.title ? { title: args.title } : {}),
    } };
    if (action === 'node-delete') return { method: 'DELETE', path: `${base}/${enc(space)}/nodes/${enc(state.nodeToken)}`, body: { obj_type: args['obj-type'], include_children: args['include-children'] } };
    if (action === 'delete-space') return { method: 'DELETE', path: `${base}/${enc(space)}` };
    if (action === 'move-to-drive') return { method: 'POST', path: `/open-apis/wiki/v2/nodes/${enc(args['node-token'])}/move_wiki_to_docs`, body: { ...(args['folder-token'] ? { folder_token: args['folder-token'] } : {}) } };
    if (args['node-token']) return { method: 'POST', path: `${base}/${enc(source)}/nodes/${enc(state.nodeToken)}/move`, body: {
        ...(args['target-space-id'] ? { target_space_id: args['target-space-id'] } : {}), ...(state.parentToken ? { target_parent_token: state.parentToken } : {}),
    } };
    return { method: 'POST', path: `${base}/${enc(args['target-space-id'])}/nodes/move_docs_to_wiki`, body: {
        obj_type: args['obj-type'], obj_token: args['obj-token'], ...(args['target-parent-token'] ? { parent_wiki_token: args['target-parent-token'] } : {}), ...(args.apply ? { apply: true } : {}),
    } };
}
export function nodePreview(action: string, args: JsonObject) {
    const requests: ApiRequest[] = [];
    if (action === 'node-get') return { requests: [lookup(args['node-token'])] };
    const state: JsonObject = { space: args['space-id'] || '{resolved_space_id}', sourceSpace: args['source-space-id'] || '{resolved_source_space_id}', nodeToken: '{resolved_node_token}' };
    if (action === 'node-create') {
        if (args['space-id'] === 'my_library' || (!args['space-id'] && !args['parent-node-token'])) requests.push({ method: 'GET', path: `${base}/my_library` });
        if (args['parent-node-token']) { requests.push(lookup(args['parent-node-token'])); state.parentToken = '{resolved_parent_node_token}'; }
    }
    if (action === 'node-delete' || (action === 'move' && args['node-token'])) requests.push(lookup(args['node-token']));
    if (action === 'move' && args['node-token'] && args['target-parent-token']) { requests.push(lookup(args['target-parent-token'])); state.parentToken = '{resolved_parent_node_token}'; }
    requests.push(mutation(action, args, state));
    return { requests, ...(action.includes('delete') || action.startsWith('move') ? { asynchronousTasks: 'Poll through workflow.resume; never repeat the mutation.' } : {}) };
}
type Step = Awaited<ReturnType<WorkflowProgram['step']>>;
export async function nodeStep(action: string, state: JsonObject, context: CommandContext): Promise<Step> {
    const args = obj(state.args), next = (changes: JsonObject): Extract<Step, { done: false }> => ({ done: false, state: { ...state, ...changes } });
    const phase = str(state.phase) || 'start';
    if (phase === 'complete') return { done: true, output: state.output };
    if (phase === 'poll') return poll(action, state, context);
    if (phase === 'permission') {
        const output = obj(state.output), profile = context.grant.profiles.find((item) => item.profileId === context.selection.profileId);
        const account = context.selection.accountId || (profile?.accounts.length === 1 ? profile.accounts[0] : undefined);
        let status = 'skipped';
        if (account && profile?.accounts.includes(account)) {
            try { await context.lark.request({ method: 'POST', path: `/open-apis/drive/v1/permissions/${enc(output.node_token)}/members`, query: { type: 'wiki', need_notification: false }, body: { member_type: 'openid', member_id: account, perm: 'full_access', type: 'user' } }); status = 'granted'; } catch { status = 'failed'; }
        }
        return { done: true, output: { ...output, permission_grant: { status, perm: 'full_access', ...(account ? { member_id: account } : { reason: 'No unambiguous authorized user account is available.' }) } } };
    }
    if (action === 'node-get') {
        const result = await context.lark.request(lookup(args['node-token']));
        if (!result.node || typeof result.node !== 'object') throw new ServiceError('INVALID_RESPONSE', 'Wiki lookup omitted node.');
        const node = obj(result.node);
        if (args['space-id'] && node.space_id && args['space-id'] !== node.space_id) invalid('space-id does not match the resolved node.');
        const output = Object.fromEntries(['space_id', 'node_token', 'obj_token', 'obj_type', 'node_type', 'parent_node_token', 'origin_node_token', 'title', 'owner', 'obj_edit_time', 'obj_create_time', 'node_create_time'].map((key) => [key, str(node[key])]));
        const timestamp = /^-?\d+$/.test(str(node.obj_edit_time)) ? new Date(Number(node.obj_edit_time) * 1000) : undefined;
        return { done: true, output: { ...output, has_child: node.has_child === true, creator: str(node.node_creator) || str(node.creator), updated_at: timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toISOString().replace('.000Z', 'Z') : '', ...(args['space-id'] && !node.space_id ? { warning: 'space-id could not be verified because the response omitted it.' } : {}) } };
    }
    if (action === 'node-create') {
        if (!state.space && (args['space-id'] === 'my_library' || (!args['space-id'] && !args['parent-node-token']))) {
            const response = await context.lark.request({ method: 'GET', path: `${base}/my_library` });
            return next({ space: requireResponse(obj(response.space).space_id, 'space_id'), resolvedBy: 'my_library' });
        }
        if (args['parent-node-token'] && !state.parentToken) {
            const response = await context.lark.request(lookup(args['parent-node-token'])), parent = obj(response.node);
            const space = requireResponse(parent.space_id, 'space_id'), expected = str(state.space || args['space-id']);
            if (expected && expected !== space) invalid('space-id does not match parent space.');
            return next({ space, parentToken: requireResponse(parent.node_token, 'node_token'), resolvedBy: state.resolvedBy || (args['space-id'] ? 'explicit_space_id' : 'parent_node_token') });
        }
    }
    if ((action === 'node-delete' || (action === 'move' && args['node-token'])) && !state.nodeToken) {
        const response = await context.lark.request(lookup(args['node-token'])), node = obj(response.node);
        const space = requireResponse(node.space_id, 'space_id'), expected = str(action === 'move' ? args['source-space-id'] : args['space-id']);
        if (expected && expected !== space) invalid('Source space does not match the resolved node.');
        let nodeToken = requireResponse(node.node_token, 'node_token');
        if (action === 'node-delete' && args['obj-type'] !== 'wiki') {
            if (node.node_type === 'shortcut') invalid('Deleting a shortcut requires obj-type wiki.');
            if (args['obj-type'] !== node.obj_type) invalid('obj-type does not match resolved document.');
            nodeToken = requireResponse(node.obj_token, 'obj_token');
        }
        return next({ nodeToken, space, sourceSpace: space });
    }
    if (action === 'move' && args['node-token'] && args['target-parent-token'] && !state.parentToken) {
        const response = await context.lark.request(lookup(args['target-parent-token'])), parent = obj(response.node);
        const space = requireResponse(parent.space_id, 'space_id');
        if (args['target-space-id'] && args['target-space-id'] !== space) invalid('target-space-id does not match parent space.');
        return next({ parentToken: requireResponse(parent.node_token, 'node_token'), targetSpace: space });
    }
    let response: JsonObject;
    try { response = await context.lark.request(mutation(action, args, state)); }
    catch (error) {
        if ((action === 'node-create' || action === 'node-copy') && error instanceof ServiceError && error.details?.upstreamCode === 131009 && Number(state.retries ?? 0) < 2) {
            return { ...next({ retries: Number(state.retries ?? 0) + 1 }), retryAfter: 250 * 2 ** Number(state.retries ?? 0) };
        }
        throw error;
    }
    if (action === 'node-create' || action === 'node-copy' || (action === 'move' && args['node-token'])) {
        if (!response.node || typeof response.node !== 'object') throw new ServiceError('INVALID_RESPONSE', 'Wiki mutation response omitted node.');
        const node = obj(response.node);
        const output = { ...node, ...(['node-create', 'node-copy'].includes(action) && node.node_token ? { url: str(node.url) || `https://${context.lark.brand === 'lark' ? 'larksuite.com' : 'feishu.cn'}/wiki/${encodeURIComponent(str(node.node_token))}` } : {}), ...(action === 'node-create' ? { resolved_space_id: state.space || args['space-id'], resolved_by: state.resolvedBy || 'explicit_space_id' } : {}), ...(action === 'move' ? { mode: 'node', source_space_id: state.sourceSpace, target_space_id: state.targetSpace || args['target-space-id'] || state.sourceSpace } : {}) };
        if (action === 'node-create' && context.selection.identity === 'bot') return next({ phase: 'permission', output });
        return { done: true, output };
    }
    const output: JsonObject = action === 'delete-space' ? { space_id: args['space-id'] } : action === 'node-delete' ? { space_id: state.space, node_token: state.nodeToken, obj_type: args['obj-type'], include_children: args['include-children'] } : action === 'move-to-drive' ? { node_token: args['node-token'], folder_token: args['folder-token'] || '' } : { mode: 'docs_to_wiki', obj_type: args['obj-type'], obj_token: args['obj-token'], target_space_id: args['target-space-id'], target_parent_token: args['target-parent-token'] || '' };
    if (response.wiki_token) return { done: true, output: { ...output, ready: true, failed: false, wiki_token: response.wiki_token, node_token: response.wiki_token } };
    if (response.applied === true) return { done: true, output: { ...output, applied: true, ready: false, failed: false, status_msg: 'move request submitted for approval' } };
    if (response.task_id) return next({ output, taskId: response.task_id, phase: 'poll', polls: 0 });
    if (action.includes('delete')) return { done: true, output: { ...output, ready: true, failed: false, status: 'success', status_msg: 'success' } };
    throw new ServiceError('INVALID_RESPONSE', 'Wiki move response omitted a result or task ID.');
}
async function poll(action: string, state: JsonObject, context: CommandContext): Promise<Step> {
    const taskType = action === 'delete-space' ? 'delete_space' : action === 'node-delete' ? 'delete_node' : action === 'move-to-drive' ? 'move_wiki_to_docs' : 'move';
    const response = await context.lark.request({ method: 'GET', path: `/open-apis/wiki/v2/tasks/${enc(state.taskId)}`, query: { task_type: taskType } });
    if (!response.task || typeof response.task !== 'object') throw new ServiceError('INVALID_RESPONSE', 'Wiki polling response omitted task.');
    const task = obj(response.task);
    let result: JsonObject;
    if (action === 'move') {
        const results = Array.isArray(task.move_result) ? task.move_result.map(obj) : [];
        result = results.find((item) => Number(item.status) < 0) || results.find((item) => Number(item.status) > 0) || results[0] || { status: 1 };
    } else result = obj(task[action === 'delete-space' ? 'delete_space_result' : action === 'node-delete' ? 'simple_task_result' : 'move_wiki_to_docs_result']);
    if (action === 'move-to-drive' && typeof result.status !== 'number') throw new ServiceError('INVALID_RESPONSE', 'Wiki move-to-drive task omitted status.');
    const deletion = action.includes('delete'), status = result.status ?? (deletion ? 'processing' : 1);
    if (!deletion && (typeof status !== 'number' || (action === 'move-to-drive' && ![-1, 0, 1].includes(status)))) throw new ServiceError('INVALID_RESPONSE', 'Wiki task returned an unsupported numeric status.');
    const ready = deletion ? str(status).toLowerCase() === 'success' : status === 0;
    const failed = deletion ? ['failed', 'failure'].includes(str(status).toLowerCase()) : Number(status) < 0;
    if (failed) throw new ServiceError('UPSTREAM_TASK_FAILED', 'The Wiki asynchronous task failed.', 502, { taskId: state.taskId, status });
    const output = { ...obj(state.output), ...obj(result.node), ...Object.fromEntries(['obj_token', 'obj_type', 'url'].filter((key) => result[key]).map((key) => [key, result[key]])), task_id: state.taskId, ready, failed, status, status_msg: result.status_msg || (ready ? 'success' : 'processing') };
    const polls = Number(state.polls ?? 0) + 1;
    if (ready) return { done: true, output };
    if (polls >= 30) return { done: true, output: { ...output, timed_out: true, next_command: { command: 'drive.+task_result', args: { scenario: `wiki_${taskType === 'move_wiki_to_docs' ? 'move_to_drive' : taskType}`, 'task-id': state.taskId } } } };
    return { done: false, state: { ...state, polls }, retryAfter: 2000 };
}

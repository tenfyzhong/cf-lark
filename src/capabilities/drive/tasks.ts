import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { grantCurrentUser } from './commands';
import { enc, invalid, obj, resource, str } from './helpers';
import { driveMutationDefinitions, driveTaskResultDefinition } from './task-definitions';
function taskRequest(args: JsonObject): ApiRequest {
    const scenario = str(args.scenario).toLowerCase();
    if (scenario === 'import' || scenario === 'export') {
        resource(args.ticket, 'ticket');
        if (scenario === 'export') resource(args['file-token'], 'file-token');
        return { method: 'GET', path: `/open-apis/drive/v1/${scenario}_tasks/${enc(args.ticket)}`, ...(scenario === 'export' ? { query: { token: args['file-token'] } } : {}) };
    }
    resource(args['task-id'], 'task-id');
    if (scenario === 'task_check') return { method: 'GET', path: '/open-apis/drive/v1/files/task_check', query: { task_id: args['task-id'] } };
    const taskType = ({ wiki_move: 'move', wiki_move_to_drive: 'move_wiki_to_docs', wiki_delete_space: 'delete_space', wiki_delete_node: 'delete_node' } as Record<string, string>)[scenario];
    if (!taskType) invalid('Unsupported task scenario.');
    return { method: 'GET', path: `/open-apis/wiki/v2/tasks/${enc(args['task-id'])}`, query: { task_type: taskType } };
}
export function normalizeTaskResult(args: JsonObject, data: JsonObject): JsonObject {
    const scenario = str(args.scenario).toLowerCase();
    if (scenario === 'import' || scenario === 'export') {
        const result = obj(data.result ?? (scenario === 'import' ? data : {})), status = Number(result.job_status ?? 0), token = str(result[scenario === 'import' ? 'token' : 'file_token']);
        const ready = status === 0 && Boolean(token), failed = ![0, 1, 2].includes(status);
        const labels: Partial<Record<number, string>> = { 1: 'new', 2: 'processing', ...(scenario === 'export' ? { 3: 'internal_error', 107: 'export_size_limit', 108: 'timeout', 109: 'export_block_not_permitted', 110: 'no_permission', 111: 'docs_deleted', 122: 'export_denied_on_copying', 123: 'docs_not_exist', 6000: 'export_images_exceed_limit' } : {}) };
        return { scenario, ticket: args.ticket, type: str(result.type), ready, failed, job_status: status, job_status_label: status === 0 ? ready ? 'success' : 'pending' : labels[status] || `status_${status}`, job_error_msg: str(result.job_error_msg), ...(scenario === 'import' ? { token, url: str(result.url), extra: result.extra ?? null } : { file_extension: str(result.file_extension), file_name: str(result.file_name), file_token: token, file_size: Number(result.file_size ?? 0) }) };
    }
    if (scenario === 'task_check') {
        const status = str(obj(data.result ?? data).status) || 'unknown';
        return { scenario, task_id: args['task-id'], status, ready: status.toLowerCase() === 'success', failed: ['fail', 'failed'].includes(status.toLowerCase()) };
    }
    if (!data.task || typeof data.task !== 'object') throw new ServiceError('INVALID_RESPONSE', 'Wiki task response omitted task.');
    const task = obj(data.task), taskId = task.task_id || args['task-id'];
    if (scenario === 'wiki_move' || scenario === 'wiki_move_to_drive') {
        const rows = scenario === 'wiki_move' ? (Array.isArray(task.move_result) ? task.move_result.map(obj) : []) : [obj(task.move_wiki_to_docs_result)];
        if (scenario === 'wiki_move_to_drive' && (typeof rows[0]!.status !== 'number' || ![-1, 0, 1].includes(Number(rows[0]!.status)))) throw new ServiceError('INVALID_RESPONSE', 'Wiki move-to-drive task omitted a supported status.');
        const primary = rows.find((item) => Number(item.status) < 0) || rows.find((item) => Number(item.status) > 0) || rows[0] || { status: 1 }, status = Number(primary.status);
        const node = obj(rows[0]?.node);
        return { scenario, task_id: taskId, ready: rows.length > 0 && rows.every((item) => Number(item.status) === 0), failed: rows.some((item) => Number(item.status) < 0), status, status_msg: primary.status_msg || (status === 0 ? 'success' : status < 0 ? 'failure' : 'processing'), ...(scenario === 'wiki_move' ? { ...node, ...(node.node_token ? { wiki_token: node.node_token } : {}) } : { obj_token: str(primary.obj_token), obj_type: str(primary.obj_type), url: str(primary.url) }) };
    }
    const result = obj(task[scenario === 'wiki_delete_space' ? 'delete_space_result' : 'simple_task_result']), status = str(result.status) || 'processing';
    return { scenario, task_id: taskId, status, status_msg: str(result.status_msg) || status, ready: status.toLowerCase() === 'success', failed: ['failure', 'failed'].includes(status.toLowerCase()) };
}
export function driveTaskResultCapability(): Capability {
    return { definition: driveTaskResultDefinition,
        async preview(args) { return { requests: [taskRequest(args)] }; },
        async execute(args, context) {
            const result = normalizeTaskResult(args, await context.lark.request(taskRequest(args)));
            if (result.scenario === 'import' && result.ready && context.selection.identity === 'bot') result.permission_grant = context.grant.permissions.includes('write') ? await grantCurrentUser(context, str(result.token), str(result.type)) : { skipped: true, reason: 'Drive write permission is required.' };
            return result;
        },
    };
}
function mutationArgs(action: string, input: JsonObject) {
    const args: JsonObject = { ...input, 'file-token': resource(input['file-token']), type: str(input.type).toLowerCase() };
    const types = ['file', 'docx', 'bitable', 'doc', 'sheet', 'mindnote', 'folder', 'slides', ...(action === 'delete' ? ['shortcut'] : [])];
    if (!types.includes(str(args.type))) invalid('Unsupported Drive resource type.');
    if (args['folder-token']) resource(args['folder-token'], 'folder-token');
    return args;
}
function mutationRequest(action: string, args: JsonObject): ApiRequest {
    const path = `/open-apis/drive/v1/files/${enc(args['file-token'])}`;
    return action === 'delete' ? { method: 'DELETE', path, query: { type: args.type } } : { method: 'POST', path: `${path}/move`, body: { type: args.type, folder_token: args['folder-token'] } };
}
export function driveMutationPrograms(): WorkflowProgram[] {
    return driveMutationDefinitions.map((definition) => {
        const action = definition.id.slice('drive.+'.length);
        return { id: `drive-${action}`, domain: 'drive', risk: 'write', identities: definition.identities, version: 1,
            async step(state, context) {
                const args = mutationArgs(action, obj(state.args));
                if (state.taskId) {
                    const taskArgs = { scenario: 'task_check', 'task-id': state.taskId }, result = normalizeTaskResult(taskArgs, await context.lark.request(taskRequest(taskArgs)));
                    if (result.failed) throw new ServiceError('UPSTREAM_TASK_FAILED', 'The Drive task failed.', 502, { taskId: state.taskId });
                    const polls = Number(state.polls ?? 0) + 1;
                    if (!result.ready && polls < 30) return { done: false, state: { ...state, polls }, retryAfter: 2000 };
                    return { done: true, output: { file_token: args['file-token'], ...(action === 'move' ? { folder_token: args['folder-token'] } : { type: args.type }), task_id: state.taskId, status: result.status, ready: result.ready, ...(action === 'delete' && result.ready ? { deleted: true } : {}), ...(!result.ready ? { timed_out: true, next_command: { command: 'drive.+task_result', args: taskArgs } } : {}) } };
                }
                if (action === 'move' && !args['folder-token']) {
                    const data = await context.lark.request({ method: 'GET', path: '/open-apis/drive/explorer/v2/root_folder/meta' });
                    if (!str(data.token)) throw new ServiceError('INVALID_RESPONSE', 'Root folder lookup omitted token.');
                    return { done: false, state: { args: { ...args, 'folder-token': data.token } } };
                }
                const data = await context.lark.request(mutationRequest(action, args));
                if (data.task_id && (action === 'delete' || args.type === 'folder')) return { done: false, state: { args, taskId: data.task_id, polls: 0 } };
                return { done: true, output: action === 'delete' ? { deleted: true, file_token: args['file-token'], type: args.type } : { file_token: args['file-token'], folder_token: args['folder-token'], status: 'success', ...(args.type === 'folder' ? { ready: true } : {}) } };
            },
        };
    });
}
export function driveMutationCapabilities(workflows: WorkflowRunner): Capability[] {
    return driveMutationDefinitions.map((definition) => {
        const action = definition.id.slice('drive.+'.length);
        return { definition,
            async preview(input) { const args = mutationArgs(action, input); return { requests: [...(action === 'move' && !args['folder-token'] ? [{ method: 'GET', path: '/open-apis/drive/explorer/v2/root_folder/meta' }] : []), mutationRequest(action, { ...args, 'folder-token': args['folder-token'] || '{resolved_root_folder}' })], asynchronousTasks: 'Poll through workflow.resume without replaying the mutation.' }; },
            async execute(input, context) { return workflows.start(`drive-${action}`, { args: mutationArgs(action, input) }, context.selection, context.grant); },
        };
    });
}

import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { ContentHasher } from '../../ports/content-hasher';
import type { Capability } from '../../ports/capabilities';
import type { LarkTransferClient } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { fileUploadProgram, saveDownloadResponse } from '../files/index';
import { driveDirectoryDefinitions } from './directory-definitions';
import { compareTimes, parseManifest, resolveRemote, safeRelative, uniqueSibling, validateDirectoryArgs, type DirectoryEntry } from './directory-model';
import { enc, invalid, obj, resource, str } from './helpers';
const rows = (value: unknown): DirectoryEntry[] => Array.isArray(value) ? value as DirectoryEntry[] : [];
const list = (value: unknown): JsonObject[] => Array.isArray(value) ? value.map(obj) : [];
function diffEntry(path: string, remote?: DirectoryEntry) { return { rel_path: path, ...(remote ? { file_token: remote.token } : {}) }; }
function initialSummary() { return { uploaded: 0, downloaded: 0, pushed: 0, pulled: 0, skipped: 0, failed: 0, deleted_local: 0, deleted_remote: 0, aborted: false }; }
function summaryFor(action: string, value: JsonObject) { const keys = action === 'push' ? ['uploaded', 'skipped', 'failed', 'deleted_remote', 'aborted'] : action === 'pull' ? ['downloaded', 'skipped', 'failed', 'deleted_local', 'aborted'] : ['pushed', 'pulled', 'skipped', 'failed', 'aborted']; return Object.fromEntries(keys.map((key) => [key, value[key]])); }
function planActions(action: string, args: JsonObject, local: DirectoryEntry[], remote: DirectoryEntry[], diff: JsonObject) {
    const localMap = new Map(local.map((item) => [item.path, item])), remoteMap = new Map(remote.map((item) => [item.path, item]));
    const actions: JsonObject[] = [], occupied = new Set([...localMap.keys(), ...remoteMap.keys()]);
    if (action === 'push' || action === 'sync') {
        for (const item of local) { const other = remoteMap.get(item.path); if (other && (item.type === 'directory' ? other.type !== 'folder' : other.type !== 'file')) throw new ServiceError('PATH_TYPE_CONFLICT', 'A local path conflicts with a remote resource type.', 409, { path: item.path }); }
        for (const item of local.filter((entry) => entry.type === 'directory').sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))) if (!remoteMap.has(item.path)) actions.push({ kind: 'folder', path: item.path });
    }
    if (action === 'push') {
        const policy = str(args['if-exists']) || 'skip';
        for (const item of local.filter((entry) => entry.type === 'file')) { const other = remoteMap.get(item.path); const comparison = other ? compareTimes(other.modified_time, item.modified_time) : undefined; actions.push({ kind: other && (policy === 'skip' || policy === 'smart' && comparison !== undefined && comparison >= 0) ? 'skip' : 'push', path: item.path, ...(other ? { token: other.token } : {}) }); }
    } else if (action === 'pull') {
        for (const item of remote.filter((entry) => entry.type === 'folder')) { const other = localMap.get(item.path); if (other && other.type !== 'directory') throw new ServiceError('PATH_TYPE_CONFLICT', 'A remote folder conflicts with a local file.', 409, { path: item.path }); if (!other) actions.push({ kind: 'local-folder', path: item.path }); }
        const policy = str(args['if-exists']) || 'overwrite';
        for (const item of remote.filter((entry) => entry.type === 'file')) { const other = localMap.get(item.path); if (other && other.type !== 'file') throw new ServiceError('PATH_TYPE_CONFLICT', 'A remote file conflicts with a local directory.', 409, { path: item.path }); const comparison = other ? compareTimes(item.modified_time, other.modified_time) : undefined; actions.push({ kind: other && (policy === 'skip' || policy === 'smart' && comparison !== undefined && comparison <= 0) ? 'skip' : 'pull', path: item.path, token: item.token, modified_time: item.modified_time || '' }); }
    } else if (action === 'sync') {
        for (const item of list(diff.new_local)) actions.push({ kind: 'push', path: item.rel_path });
        for (const item of list(diff.new_remote)) actions.push({ kind: 'pull', path: item.rel_path, token: item.file_token });
        for (const item of list(diff.unchanged)) actions.push({ kind: 'skip', path: item.rel_path, token: item.file_token });
        for (const item of list(diff.modified)) {
            const decision = str(args['on-conflict']) === 'ask' ? str(obj(args['conflict-decisions'])[str(item.rel_path)]) : str(args['on-conflict']) || 'remote-wins';
            actions.push({ kind: decision === 'local-wins' ? 'push' : decision === 'skip' ? 'skip' : 'pull', path: item.rel_path, token: item.file_token, ...(decision === 'keep-both' ? { keepBoth: true } : {}) });
        }
    }
    if (args['delete-remote']) for (const item of remote.filter((entry) => entry.type === 'file' && !localMap.has(entry.path))) actions.push({ kind: 'delete-remote', path: item.path, token: item.token });
    if (args['delete-local']) for (const item of local.filter((entry) => entry.type === 'file' && !remoteMap.has(entry.path))) actions.push({ kind: 'delete-local', path: item.path });
    return { actions, occupied: [...occupied] };
}
export function driveDirectoryPrograms(artifacts: ArtifactFiles, hasher: ContentHasher): WorkflowProgram[] {
    const upload = fileUploadProgram(artifacts, { id: 'drive-directory-upload', domain: 'drive' });
    return driveDirectoryDefinitions.map((definition) => {
        const action = definition.id.slice('drive.+'.length);
        return { id: `drive-${action}`, domain: 'drive', risk: definition.risk, identities: definition.identities, version: 1,
            async step(state, context) {
                const args = obj(state.args), next = (patch: JsonObject) => ({ done: false as const, state: { ...state, ...patch } });
                if (state.phase === 'start') {
                    validateDirectoryArgs(action, args);
                    authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
                    if (action !== 'status') authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
                    const artifact = await artifacts.stat(context.grant.id, str(args['local-dir']));
                    if (artifact.size > 4 * 1024 * 1024) throw new ServiceError('MANIFEST_TOO_LARGE', 'Directory manifest metadata exceeds the 4 MiB processing limit.', 413);
                    let value: unknown; try { value = await (await artifacts.read(context.grant.id, str(args['local-dir']))).json(); } catch { invalid('local-dir must contain a JSON directory manifest.'); }
                    const local = parseManifest(value);
                    return next({ local, remote: [], queue: [{ token: args['folder-token'], path: '', cursor: '', seen: [] }], visited: [args['folder-token']], phase: 'list', summary: initialSummary(), items: [] });
                }
                if (state.phase === 'list') {
                    const queue = list(state.queue), current = queue[0]; if (!current) return next({ phase: 'prepare' });
                    const response = await context.lark.request({ method: 'GET', path: '/open-apis/drive/v1/files', query: { folder_token: current.token, page_size: '200', ...(current.cursor ? { page_token: current.cursor } : {}) } });
                    const remote = rows(state.remote), pending: JsonObject[] = [], visited = new Set(Array.isArray(state.visited) ? state.visited.map(String) : []);
                    for (const raw of list(response.files)) {
                        if (!str(raw.name) || !str(raw.token)) continue;
                        const name = safeRelative(raw.name); if (name.includes('/')) invalid('A remote entry name must not contain a path separator.');
                        const path = current.path ? `${current.path}/${name}` : name, token = resource(raw.token), type = str(raw.type);
                        remote.push({ path, type, token, modified_time: str(raw.modified_time), created_time: str(raw.created_time), size: Number(raw.size || 0) });
                        if (type === 'folder') { if (visited.has(token)) throw new ServiceError('DIRECTORY_CYCLE', 'Recursive folder listing repeated a folder token.', 502); visited.add(token); pending.push({ token, path, cursor: '', seen: [] }); }
                    }
                    const cursor = str(response.page_token || response.next_page_token), seen = Array.isArray(current.seen) ? current.seen : [];
                    if (response.has_more === true && cursor) { if (cursor === current.cursor || seen.includes(cursor)) throw new ServiceError('INVALID_PAGINATION', 'Folder pagination did not advance.', 502); queue[0] = { ...current, cursor, seen: [...seen, cursor] }; } else queue.shift();
                    return next({ remote, queue: [...queue, ...pending], visited: [...visited] });
                }
                if (state.phase === 'prepare') {
                    const remote = await resolveRemote(rows(state.remote), action === 'status' ? 'fail' : str(args['on-duplicate-remote']) || 'fail', hasher), local = rows(state.local);
                    const paths = [...new Set([...local.filter((entry) => entry.type === 'file').map((entry) => entry.path), ...remote.filter((entry) => entry.type === 'file').map((entry) => entry.path)])].sort();
                    return next({ remote, paths, index: 0, diff: { detection: args.quick ? 'quick' : 'exact', new_local: [], new_remote: [], modified: [], unchanged: [] }, phase: ['status', 'sync'].includes(action) ? 'compare' : 'plan' });
                }
                if (state.phase === 'compare') {
                    const paths = Array.isArray(state.paths) ? state.paths as string[] : [], index = Number(state.index), path = paths[index];
                    if (path === undefined) return action === 'status' ? { done: true, output: state.diff } : next({ phase: 'plan' });
                    const local = rows(state.local).find((item) => item.path === path && item.type === 'file'), remote = rows(state.remote).find((item) => item.path === path && item.type === 'file'), diff = obj(state.diff);
                    const add = (key: string) => next({ diff: { ...diff, [key]: [...list(diff[key]), diffEntry(path, remote)] }, index: index + 1, localHash: undefined });
                    if (!remote) return add('new_local'); if (!local) return add('new_remote');
                    if (args.quick) return add(compareTimes(remote.modified_time, local.modified_time) === 0 ? 'unchanged' : 'modified');
                    if (!state.localHash) {
                        const response = await artifacts.read(context.grant.id, str(local.artifact_id)); if (!response.body) throw new ServiceError('INVALID_FILE', 'Local artifact has no body.');
                        return next({ localHash: await hasher.sha256(response.body) });
                    }
                    const response = await (context.lark as LarkTransferClient).download({ path: `/open-apis/drive/v1/files/${enc(remote.token)}/download` });
                    if (!response.ok || !response.body) throw new ServiceError('INVALID_DOWNLOAD', 'Remote hash download failed.', 502);
                    return add(await hasher.sha256(response.body) === state.localHash ? 'unchanged' : 'modified');
                }
                if (state.phase === 'plan') {
                    if (action === 'sync' && args['on-conflict'] === 'ask') { const conflicts = list(obj(state.diff).modified).map((item) => str(item.rel_path)).filter((path) => !obj(args['conflict-decisions'])[path]); if (conflicts.length) return { done: true, output: { requires_decisions: true, conflicts, diff: state.diff, next_command: { command: 'drive.+sync', args, instruction: 'Supply conflict-decisions for every unresolved relative path.' } } }; }
                    const plan = planActions(action, args, rows(state.local), rows(state.remote), obj(state.diff));
                    const folders = Object.fromEntries(rows(state.remote).filter((entry) => entry.type === 'folder').map((entry) => [entry.path, entry.token]));
                    return next({ ...plan, folders: { '': args['folder-token'], ...folders }, actionIndex: 0, phase: 'act' });
                }
                if (state.phase === 'act' || state.phase === 'upload') {
                    const actions = list(state.actions), index = Number(state.actionIndex), current = actions[index];
                    if (!current) return next({ phase: 'save' });
                    const path = str(current.path), kind = str(current.kind), summary = obj(state.summary), items = list(state.items), local = rows(state.local), remote = rows(state.remote), folders = obj(state.folders);
                    const finish = (label: string, changes: JsonObject = {}, item: JsonObject = {}) => next({ ...changes, actionIndex: index + 1, phase: 'act', upload: {}, summary, items: [...items, { rel_path: path, ...(current.token ? { file_token: current.token } : {}), action: label, ...item }] });
                    if (kind.startsWith('delete-') && Number(summary.failed) > 0) return finish('delete_skipped', {}, { reason: 'Earlier transfers failed; destructive cleanup was skipped.' });
                    try {
                        if (kind === 'skip') { summary.skipped = Number(summary.skipped) + 1; return finish('skipped'); }
                        if (kind === 'local-folder') return finish('created_directory', { local: [...local, { path, type: 'directory' }] });
                        if (kind === 'folder') {
                            const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', parentToken = folders[parent];
                            if (!parentToken) throw new ServiceError('PARENT_FOLDER_FAILED', 'The parent folder was not created.');
                            const response = await context.lark.request({ method: 'POST', path: '/open-apis/drive/v1/files/create_folder', body: { name: path.split('/').at(-1), folder_token: parentToken } });
                            if (!str(response.token)) throw new ServiceError('INVALID_RESPONSE', 'Folder creation omitted token.');
                            return finish('created_folder', { folders: { ...folders, [path]: response.token } });
                        }
                        if (kind === 'push') {
                            if (state.phase === 'upload') {
                                const result = await upload.step(obj(state.upload), context); if (!result.done) return next({ upload: result.state });
                                summary.uploaded = Number(summary.uploaded) + 1; summary.pushed = Number(summary.pushed) + 1;
                                return finish(current.token ? 'overwritten' : 'uploaded', {}, { ...obj(result.output), size_bytes: obj(result.output).size });
                            }
                            const entry = local.find((item) => item.path === path && item.type === 'file'); if (!entry) throw new ServiceError('INVALID_FILE', 'The planned local file is missing.');
                            const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; if (!folders[parent]) throw new ServiceError('PARENT_FOLDER_FAILED', 'The parent folder is unavailable.');
                            return next({ phase: 'upload', upload: { phase: 'start', args: { file: entry.artifact_id, name: path.split('/').at(-1), 'folder-token': folders[parent], ...(current.token ? { 'file-token': current.token } : {}) } } });
                        }
                        if (kind === 'pull') {
                            const response = await (context.lark as LarkTransferClient).download({ path: `/open-apis/drive/v1/files/${enc(current.token)}/download` });
                            const saved = await saveDownloadResponse(artifacts, context, response, path.split('/').at(-1)!);
                            let nextLocal = [...local];
                            if (current.keepBoth) { const existing = nextLocal.find((entry) => entry.path === path), occupied = new Set([...nextLocal.map((entry) => entry.path), ...remote.map((entry) => entry.path)]); if (existing) { const name = await uniqueSibling(path, str(current.token), occupied, hasher); nextLocal = nextLocal.map((entry) => entry.path === path ? { ...entry, path: name } : entry); } }
                            const modified = str(current.modified_time) || str(remote.find((entry) => entry.path === path)?.modified_time);
                            nextLocal = nextLocal.filter((entry) => entry.path !== path); nextLocal.push({ path, type: 'file', artifact_id: saved.artifact_id, ...(modified ? { modified_time: modified } : {}) });
                            summary.downloaded = Number(summary.downloaded) + 1; summary.pulled = Number(summary.pulled) + 1;
                            return finish(current.keepBoth ? 'kept_both' : 'downloaded', { local: parseManifest({ version: 1, entries: nextLocal }) }, { artifact_id: saved.artifact_id, size_bytes: saved.size_bytes });
                        }
                        if (kind === 'delete-local') { summary.deleted_local = Number(summary.deleted_local) + 1; return finish('deleted_local', { local: local.filter((entry) => entry.path !== path) }); }
                        if (kind === 'delete-remote') {
                            const result = await context.lark.request({ method: 'DELETE', path: `/open-apis/drive/v1/files/${enc(current.token)}`, query: { type: 'file' } });
                            if (result.task_id) return next({ deletionTask: result.task_id, deletionPolls: 0, phase: 'delete-poll' });
                            summary.deleted_remote = Number(summary.deleted_remote) + 1; return finish('deleted_remote');
                        }
                        throw new ServiceError('INVALID_WORKFLOW_STATE', 'Unknown directory operation.');
                    } catch (error) {
                        summary.failed = Number(summary.failed) + 1;
                        const terminal = error instanceof ServiceError && ([401, 403, 429].includes(error.status) || ['GRANT_EXPIRED', 'FORBIDDEN'].includes(error.code));
                        if (terminal) summary.aborted = true;
                        return { ...finish('failed', terminal ? { actions: actions.slice(0, index + 1) } : {}, { error: error instanceof ServiceError ? error.code : 'TRANSFER_FAILED', phase: kind }), done: false };
                    }
                }
                if (state.phase === 'delete-poll') {
                    const response = await context.lark.request({ method: 'GET', path: '/open-apis/drive/v1/files/task_check', query: { task_id: state.deletionTask } }), status = str(obj(response.result ?? response).status).toLowerCase();
                    if (!['success', 'fail', 'failed'].includes(status) && Number(state.deletionPolls) < 29) return { ...next({ deletionPolls: Number(state.deletionPolls) + 1 }), retryAfter: 2000 };
                    const success = status === 'success', summary = obj(state.summary), index = Number(state.actionIndex), current = list(state.actions)[index]!;
                    summary[success ? 'deleted_remote' : 'failed'] = Number(summary[success ? 'deleted_remote' : 'failed']) + 1;
                    return next({ phase: 'act', actionIndex: index + 1, summary, items: [...list(state.items), { rel_path: current.path, action: success ? 'deleted_remote' : 'failed', task_id: state.deletionTask, ...(success ? {} : { next_command: { command: 'drive.+task_result', args: { scenario: 'task_check', 'task-id': state.deletionTask } } }) }] });
                }
                if (state.phase === 'save') {
                    const entries = parseManifest({ version: 1, entries: state.local }), blob = new Blob([JSON.stringify({ version: 1, entries })]);
                    const saved = await saveDownloadResponse(artifacts, context, new Response(blob, { headers: { 'Content-Length': String(blob.size) } }), 'directory-manifest.json');
                    const summary = obj(state.summary);
                    return { done: true, output: { manifest_artifact_id: saved.artifact_id, manifest_download_path: saved.download_path, summary: summaryFor(action, summary), items: state.items, ...(action === 'sync' ? { diff: state.diff } : {}), ...(Number(summary.failed) > 0 ? { partial_failure: true, note: 'Some items failed. Destructive cleanup was skipped after transfer failures.' } : {}) } };
                }
                throw new ServiceError('INVALID_WORKFLOW_STATE', 'Unknown directory workflow phase.', 500);
            },
        };
    });
}
export function driveDirectoryCapabilities(workflows: WorkflowRunner): Capability[] {
    return driveDirectoryDefinitions.map((definition) => {
        const action = definition.id.slice('drive.+'.length);
        return { definition, async preview(args) { validateDirectoryArgs(action, args); return { manifest: args['local-dir'], requests: [{ method: 'GET', path: '/open-apis/drive/v1/files', query: { folder_token: args['folder-token'], page_size: '200' } }], recursive: true, mutation: action !== 'status', note: 'Resolve duplicate and type conflicts before applying the file-level operation.' }; }, async execute(args, context) { validateDirectoryArgs(action, args); return workflows.start(`drive-${action}`, { phase: 'start', args }, context.selection, context.grant); } };
    });
}

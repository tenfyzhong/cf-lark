import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { Capability } from '../../ports/capabilities';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { mediaUploadProgram, saveDownloadResponse } from '../files/index';
import type { LarkTransferClient } from '../../ports/lark';
import { driveConversionDefinitions } from './conversion-definitions';
import { exportInput, exportName, importInput, validateExportFormat, validateImportSize } from './conversion-inputs';
import { enc, invalid, obj, resource, str } from './helpers';
import { grantCurrentUser } from './commands';
import { normalizeTaskResult } from './tasks';
import { resourceUrl } from './metadata';
function exportBody(args: JsonObject) { return { token: args.token, type: args['doc-type'], file_extension: args['file-extension'], ...(args['sub-id'] ? { sub_id: args['sub-id'] } : {}), ...(args['only-schema'] ? { only_schema: true } : {}) }; }
function importBody(args: JsonObject, token: unknown) { return { file_extension: args.extension, file_token: token, type: args.type, file_name: args.targetName, point: { mount_type: 1, mount_key: str(args['folder-token']) }, ...(args['target-token'] ? { token: args['target-token'] } : {}) }; }
function recover(action: string, args: JsonObject, ticket: unknown) { return { command: 'drive.+task_result', args: { scenario: action, ticket, ...(action === 'export' ? { 'file-token': args.token } : {}) } }; }
export function driveConversionPrograms(artifacts: ArtifactFiles): WorkflowProgram[] {
    const upload = mediaUploadProgram(artifacts, { id: 'drive-import-media', domain: 'drive' });
    return driveConversionDefinitions.map((definition) => {
        const action = definition.id.slice('drive.+'.length), importing = action === 'import';
        return { id: `drive-${action}`, domain: 'drive', risk: definition.risk, identities: definition.identities, version: 1,
            async step(state, context) {
                let args = obj(state.args);
                const next = (patch: JsonObject) => ({ done: false as const, state: { ...state, ...patch } });
                if (state.phase === 'start') {
                    args = importing ? importInput(args) : exportInput(args);
                    if (importing) {
                        authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
                        const artifact = await artifacts.stat(context.grant.id, str(args.file)); validateImportSize(args, artifact.size);
                        return next({ args, phase: args['folder-token'] ? 'folder-check' : 'upload-start' });
                    }
                    return next({ args, phase: args.wiki_token ? 'wiki' : args['file-extension'] === 'markdown' ? 'markdown' : 'create' });
                }
                if (state.phase === 'wiki') {
                    const node = obj((await context.lark.request({ method: 'GET', path: '/open-apis/wiki/v2/spaces/node_by_token', query: { token: args.wiki_token } })).node);
                    if (!str(node.obj_token) || !str(node.obj_type)) throw new ServiceError('INVALID_RESPONSE', 'Wiki resolution omitted document metadata.');
                    resource(node.obj_token);
                    const type = node.obj_type === 'base' ? 'bitable' : node.obj_type;
                    if (args['doc-type'] && args['doc-type'] !== type) invalid('doc-type conflicts with the Wiki document type.');
                    args = { ...args, token: node.obj_token, 'doc-type': type }; validateExportFormat(args);
                    return next({ args, annotation: { wiki_token: args.wiki_token, wiki_node: { obj_token: node.obj_token, obj_type: type } }, phase: args['file-extension'] === 'markdown' ? 'markdown' : 'create' });
                }
                if (state.phase === 'folder-check') {
                    let node: JsonObject = {};
                    try { node = obj((await context.lark.request({ method: 'GET', path: '/open-apis/wiki/v2/spaces/node_by_token', query: { token: args['folder-token'] } })).node); } catch { /* Non-Wiki folder tokens are expected to fail Wiki lookup. */ }
                    if (Object.keys(node).length) invalid('folder-token must be a Drive folder, not a Wiki node.');
                    return next({ phase: 'upload-start' });
                }
                if (state.phase === 'upload-start') return next({ phase: 'upload', upload: { phase: 'start', args: { file: args.file, name: args.sourceName, 'parent-type': 'ccm_import_open', 'parent-node': '', extra: { obj_type: args.type, file_extension: args.extension } } } });
                if (state.phase === 'upload') {
                    const result = await upload.step(obj(state.upload), context);
                    return result.done ? next({ mediaToken: obj(result.output).file_token, upload: {}, phase: 'create' }) : next({ upload: result.state });
                }
                if (state.phase === 'markdown') {
                    const document = obj((await context.lark.request({ method: 'POST', path: `/open-apis/docs_ai/v1/documents/${enc(args.token)}/fetch`, body: { format: 'markdown' } })).document);
                    if (typeof document.content !== 'string') throw new ServiceError('INVALID_RESPONSE', 'Markdown fetch omitted document.content.');
                    const blob = new Blob([document.content]);
                    const saved = await saveDownloadResponse(artifacts, context, new Response(blob, { headers: { 'Content-Length': String(blob.size) } }), exportName(args['file-name'], args.token, 'markdown'));
                    return next({ output: saved, phase: args['file-name'] ? 'complete' : 'markdown-title' });
                }
                if (state.phase === 'markdown-title') {
                    let title = ''; const output = obj(state.output);
                    try { const data = await context.lark.request({ method: 'POST', path: '/open-apis/drive/v1/metas/batch_query', body: { request_docs: [{ doc_token: args.token, doc_type: args['doc-type'] }], with_url: true } }); title = str(obj(Array.isArray(data.metas) ? data.metas[0] : {}).title); }
                    catch { output.warnings = ['Title lookup failed; used the token as the file name.']; }
                    return next({ output: { ...output, filename: exportName(title, args.token, 'markdown') }, phase: 'complete' });
                }
                if (state.phase === 'create') {
                    const result = await context.lark.request({ method: 'POST', path: `/open-apis/drive/v1/${action}_tasks`, body: importing ? importBody(args, state.mediaToken) : exportBody(args) });
                    if (!str(result.ticket)) throw new ServiceError('INVALID_RESPONSE', 'Task creation returned no ticket. Do not repeat the submitted operation.', 502);
                    return next({ ticket: result.ticket, polls: 0, failures: 0, phase: 'poll' });
                }
                if (state.phase === 'poll') {
                    const polls = Number(state.polls) + 1, taskArgs = obj(recover(action, args, state.ticket).args);
                    let result: JsonObject;
                    try { result = normalizeTaskResult(taskArgs, await context.lark.request({ method: 'GET', path: `/open-apis/drive/v1/${action}_tasks/${enc(state.ticket)}`, ...(!importing ? { query: { token: args.token } } : {}) })); }
                    catch (error) {
                        if (!importing && error instanceof ServiceError && (error.status === 429 || Number(error.details?.upstreamCode) === 99991400)) throw new ServiceError('RATE_LIMITED', 'Export status lookup was rate limited. Resume the existing ticket.', 429, { next_command: recover(action, args, state.ticket) });
                        if (polls >= 30 && !state.lastResult) throw new ServiceError('UPSTREAM_TASK_STATUS_FAILED', 'Every task status lookup failed. Resume the existing ticket.', 502, { next_command: recover(action, args, state.ticket) });
                        if (polls < 30) return { ...next({ polls, failures: Number(state.failures) + 1 }), retryAfter: 2000 };
                        result = obj(state.lastResult);
                    }
                    if (result.failed) throw new ServiceError('UPSTREAM_TASK_FAILED', 'The conversion task failed.', 502, { ticket: state.ticket, job_status: result.job_status, next_command: recover(action, args, state.ticket) });
                    const output = { ...result, ...(importing ? { type: result.type || args.type, ...(result.token && !result.url ? { url: resourceUrl(str(result.type || args.type), str(result.token), context.lark.brand) } : {}) } : {}), ...(Number(state.failures) > 0 ? { poll_summary: { attempts: polls, transient_failures: state.failures } } : {}) };
                    if (!result.ready && polls < 30) return { ...next({ polls, lastResult: result }), retryAfter: 2000 };
                    if (!result.ready) return { done: true, output: { ...output, timed_out: true, next_command: recover(action, args, state.ticket), ...obj(state.annotation) } };
                    return next({ output, phase: importing ? context.selection.identity === 'bot' ? 'permission' : 'complete' : args['skip-download'] ? 'complete' : 'download' });
                }
                if (state.phase === 'permission') {
                    const output = obj(state.output);
                    return next({ output: { ...output, permission_grant: await grantCurrentUser(context, str(output.token), str(output.type)) }, phase: 'complete' });
                }
                if (state.phase === 'download') {
                    const output = obj(state.output), name = exportName(args['file-name'] || output.file_name, args.token, args['file-extension']);
                    const response = await (context.lark as LarkTransferClient).download({ path: `/open-apis/drive/v1/export_tasks/file/${enc(output.file_token)}/download` });
                    const saved = await saveDownloadResponse(artifacts, context, response, name);
                    return next({ output: { ...output, ...saved, downloaded: true }, phase: 'complete' });
                }
                if (state.phase === 'complete') return { done: true, output: { ...obj(state.output), ...(!importing ? { token: args.token, doc_type: args['doc-type'], file_extension: args['file-extension'], ...(state.ticket ? { ticket: state.ticket } : {}) } : {}), ...obj(state.annotation) } };
                throw new ServiceError('INVALID_WORKFLOW_STATE', 'Unknown conversion phase.', 500);
            },
        };
    });
}
export function driveConversionCapabilities(workflows: WorkflowRunner): Capability[] {
    return driveConversionDefinitions.map((definition) => {
        const action = definition.id.slice('drive.+'.length);
        return { definition,
            async preview(input) { const args = action === 'import' ? importInput(input) : exportInput(input); return { args, phases: action === 'import' ? ['validate-artifact', 'check-folder', 'upload-media', 'create-import', 'poll'] : ['resolve-wiki-if-needed', args['file-extension'] === 'markdown' ? 'fetch-markdown' : 'create-export-and-poll', 'save-private-artifact'], ...(action === 'import' ? { request: { method: 'POST', path: '/open-apis/drive/v1/import_tasks', body: importBody(args, '{uploaded_media_token}') } } : { request: args['file-extension'] === 'markdown' ? { method: 'POST', path: `/open-apis/docs_ai/v1/documents/${enc(args.wiki_token ? '{resolved_document_token}' : args.token)}/fetch`, body: { format: 'markdown' } } : { method: 'POST', path: '/open-apis/drive/v1/export_tasks', body: exportBody(args) } }) }; },
            async execute(input, context) { const args = action === 'import' ? importInput(input) : exportInput(input); return workflows.start(`drive-${action}`, { phase: 'start', args: input }, context.selection, context.grant); },
        };
    });
}

export function conversionProgram(artifacts: ArtifactFiles, options: { action: 'import' | 'export'; id: string; domain: string }): WorkflowProgram {
    const program = driveConversionPrograms(artifacts).find((item) => item.id === `drive-${options.action}`)!;
    return { ...program, id: options.id, domain: options.domain };
}

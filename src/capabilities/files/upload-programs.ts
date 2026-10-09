import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
import type { LarkTransferClient } from '../../ports/lark';
import type { WorkflowProgram } from '../../ports/workflows';

const limit = 20 * 1024 * 1024;
interface UploadState extends JsonObject {
    phase: string;
    args: JsonObject;
    size: number;
    name: string;
    fields: Record<string, string>;
    uploadId: string;
    blockSize: number;
    blockCount: number;
    sequence: number;
    output: JsonObject;
}
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function transfer(context: CommandContext): LarkTransferClient {
    const client = context.lark as LarkTransferClient;
    if (typeof client.upload !== 'function') throw new ServiceError('TRANSFER_UNAVAILABLE', 'The runtime cannot upload files.', 500);
    return client;
}
function argumentsFor(args: JsonObject, media: boolean): { name: string; fields: Record<string, string> } {
    if (typeof args.file !== 'string' || !args.file.trim()) invalid('file must be a private artifact ID.');
    const name = String(args.name ?? args.file);
    if (!name.trim() || /[\r\n\0/\\]/u.test(name)) invalid('name must be a safe filename.');
    const fields: Record<string, string> = { file_name: name };
    if (media) {
        if (typeof args['parent-node'] !== 'string' || (!args['parent-node'] && args['parent-type'] !== 'ccm_import_open')) invalid('parent-node is required.');
        if (typeof args['parent-type'] !== 'string' || !args['parent-type']) invalid('parent-type is required.');
        const node = String(args['parent-node']);
        const office = node.startsWith('fake_office_') || node.startsWith('local_office_')
            || (node.length >= 25 && [4, 9, 14, 19, 24].map((offset) => node[offset]).join('') === 'OFL0X');
        fields.parent_type = office && node.endsWith('W') ? 'office_docx_file' : String(args['parent-type']);
        fields.parent_node = node;
        if (args.extra !== undefined && (!args.extra || typeof args.extra !== 'object' || Array.isArray(args.extra))) invalid('extra must be a JSON object.');
        if (args.extra !== undefined || args['doc-id'] !== undefined) fields.extra = JSON.stringify({ ...(args.extra as JsonObject ?? {}), ...(args['doc-id'] !== undefined ? { drive_route_token: args['doc-id'] } : {}) });
    } else {
        if (args['folder-token'] !== undefined && args['wiki-token'] !== undefined) invalid('folder-token and wiki-token are mutually exclusive.');
        for (const key of ['folder-token', 'wiki-token', 'file-token']) {
            if (args[key] !== undefined && (typeof args[key] !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(String(args[key])))) invalid(`${key} must be a nonempty resource token.`);
        }
        fields.parent_type = args['wiki-token'] === undefined ? 'explorer' : 'wiki';
        fields.parent_node = String(args['wiki-token'] ?? args['folder-token'] ?? '');
        if (args['file-token'] !== undefined) fields.file_token = String(args['file-token']);
    }
    return { name, fields };
}
export function uploadPreview(args: JsonObject, media: boolean) {
    const { name, fields } = argumentsFor(args, media);
    return { artifact: args.file, name, fields, singlePartPath: `/open-apis/drive/v1/${media ? 'medias' : 'files'}/upload_all`,
        multipart: ['upload_prepare', 'upload_part', 'upload_finish'], thresholdBytes: limit };
}
function fileResult(result: JsonObject, state: UploadState): JsonObject {
    if (typeof result.file_token !== 'string' || !result.file_token) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Upload returned no file token. Do not repeat the initial upload.', 502);
    return { file_token: result.file_token, file_name: state.name, size: state.size,
        ...(result.version || result.data_version ? { version: result.version || result.data_version } : {}) };
}
function currentUser(context: CommandContext): string | undefined {
    const accounts = context.grant.profiles.find((profile) => profile.profileId === context.selection.profileId)?.accounts ?? [];
    if (context.selection.accountId) {
        if (!accounts.includes(context.selection.accountId)) throw new ServiceError('FORBIDDEN', 'The permission recipient is outside the authorized accounts.', 403);
        return context.selection.accountId;
    }
    return accounts.length === 1 ? accounts[0] : undefined;
}

export function uploadPrograms(files: ArtifactFiles): WorkflowProgram[] {
    return [false, true].map((media): WorkflowProgram => ({
        id: media ? 'docs-media-upload' : 'drive-upload', version: 1, domain: media ? 'docs' : 'drive', risk: 'write', identities: ['user', 'bot'],
        async step(input, context) {
            authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
            const state = input as UploadState;
            const base = `/open-apis/drive/v1/${media ? 'medias' : 'files'}`;
            const next = (patch: JsonObject) => ({ done: false as const, state: { ...state, ...patch } });
            if (state.phase === 'start') {
                const prepared = argumentsFor(state.args, media);
                if (!media && context.selection.identity === 'bot') currentUser(context);
                const artifact = await files.stat(context.grant.id, String(state.args.file));
                return next({ ...prepared, size: artifact.size, phase: artifact.size > limit ? 'prepare' : 'single' });
            }
            if (state.phase === 'single') {
                const response = await files.read(context.grant.id, String(state.args.file));
                const body = await response.blob();
                if (body.size !== state.size || body.size > limit) throw new ServiceError('INVALID_FILE', 'The artifact size changed.');
                const fields: Record<string, string> = { ...state.fields, size: String(state.size) };
                if (fields.parent_type === 'ccm_import_open' && fields.parent_node === '') delete fields.parent_node;
                const result = await transfer(context).upload({ path: `${base}/upload_all`, fields, file: { field: 'file', name: state.name, body } });
                return next({ output: fileResult(result, state), phase: media ? 'complete' : 'metadata' });
            }
            if (state.phase === 'prepare') {
                const result = await context.lark.request({ method: 'POST', path: `${base}/upload_prepare`, body: { ...state.fields, size: state.size } });
                const blockSize = Number(result.block_size), blockCount = Number(result.block_num);
                if (typeof result.upload_id !== 'string' || !result.upload_id || !Number.isSafeInteger(blockSize) || blockSize <= 0 || blockSize > limit
                    || !Number.isSafeInteger(blockCount) || blockCount !== Math.ceil(state.size / blockSize) || blockCount > 10_000) {
                    throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'The upload preparation returned invalid block dimensions.', 502);
                }
                return next({ phase: 'part', uploadId: result.upload_id, blockSize, blockCount, sequence: 0 });
            }
            if (state.phase === 'part') {
                const offset = state.sequence * state.blockSize;
                const length = Math.min(state.blockSize, state.size - offset);
                const body = await (await files.read(context.grant.id, String(state.args.file), { offset, length })).blob();
                if (body.size !== length) throw new ServiceError('INVALID_FILE', 'The artifact range was incomplete.');
                await transfer(context).upload({ path: `${base}/upload_part`, fields: { upload_id: state.uploadId, seq: String(state.sequence), size: String(length) },
                    file: { field: 'file', name: state.name, body } });
                return next({ sequence: state.sequence + 1, phase: state.sequence + 1 === state.blockCount ? 'finish' : 'part' });
            }
            if (state.phase === 'finish') {
                const result = await context.lark.request({ method: 'POST', path: `${base}/upload_finish`, body: { upload_id: state.uploadId, block_num: state.blockCount } });
                return next({ output: fileResult(result, state), phase: media ? 'complete' : 'metadata' });
            }
            if (state.phase === 'metadata') {
                const output = { ...state.output };
                try {
                    const result = await context.lark.request({ method: 'POST', path: '/open-apis/drive/v1/metas/batch_query', body: { request_docs: [{ doc_token: output.file_token, doc_type: 'file' }], with_url: true } });
                    const meta = Array.isArray(result.metas) ? result.metas[0] as JsonObject | undefined : undefined;
                    if (typeof meta?.url === 'string' && meta.url) output.url = meta.url;
                } catch { output.warnings = ['The file was uploaded, but its URL could not be retrieved.']; }
                return next({ output, phase: context.selection.identity === 'bot' && !state.args['file-token'] ? 'permission' : 'complete' });
            }
            if (state.phase === 'permission') {
                const output = { ...state.output };
                const user = currentUser(context);
                let status = 'skipped';
                if (user) {
                    try {
                        await context.lark.request({ method: 'POST', path: `/open-apis/drive/v1/permissions/${encodeURIComponent(String(output.file_token))}/members`, query: { type: 'file', need_notification: false },
                            body: { member_type: 'openid', member_id: user, perm: 'full_access', type: 'user' } });
                        status = 'granted';
                    } catch { status = 'failed'; }
                }
                output.permission_grant = { status, perm: 'full_access', ...(user ? { member_id: user } : { reason: 'No unambiguous authorized user account is available.' }) };
                return next({ output, phase: 'complete' });
            }
            if (state.phase === 'complete') return { done: true, output: state.output };
            throw new ServiceError('INVALID_WORKFLOW_STATE', 'Unknown upload workflow phase.', 500);
        },
    }));
}

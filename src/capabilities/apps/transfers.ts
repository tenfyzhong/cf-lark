import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { RemoteFiles } from '../../ports/remote-files';
import type { LarkTransferClient } from '../../ports/lark';
import type { WorkflowProgram } from '../../ports/workflows';
import { fileResult } from './files';
export interface AppsTransferDependencies { artifacts: ArtifactFiles; remoteFiles: RemoteFiles }
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function text(args: JsonObject, key: string) { return typeof args[key] === 'string' ? args[key].trim() : ''; }
function filename(args: JsonObject) {
    const name = text(args, 'name') || text(args, 'file');
    if (!name || /[\p{Cc}/\\]/u.test(name)) invalid('name must be a safe filename.');
    return name;
}
export function transferPreview(name: string, args: JsonObject): JsonObject {
    const app = text(args, 'app-id'), token = text(args, 'meta-token');
    const output = text(args, 'output');
    if (output && (output.startsWith('/') || output.split(/[\\/]/).includes('..') || /[\p{Cc}]/u.test(output))) invalid('output must be a safe relative filename.');
    if (name === 'export') {
        if (!!app === !!token) invalid('Provide exactly one app-id or meta-token.');
        if (/[\p{Cc}\s/]/u.test(app || token)) invalid('Export requires a bare app ID or meta token.');
        return { method: 'POST', path: '/open-apis/spark/v1/apps/export', body: app ? { app_id: app } : { meta_token: token }, output: 'Private artifact' };
    }
    if (!app.startsWith('app_')) invalid('Storage requires a real app_ ID.');
    const path = `/open-apis/spark/v1/apps/${encodeURIComponent(app)}/storage`;
    if (name === 'file-upload') {
        if (!text(args, 'file')) invalid('file must be a private artifact ID.');
        return { method: 'POST', path: `${path}/file_pre_upload`, body: { file_name: filename(args) }, steps: ['Prepare upload', 'PUT artifact bytes to presigned URL', 'Register upload callback'] };
    }
    if (!text(args, 'path')) invalid('path must not be blank.');
    return { method: 'POST', path: `${path}/file_sign`, body: { path: text(args, 'path') }, output: 'Private artifact' };
}
function contentType(args: JsonObject) {
    if (text(args, 'content-type')) return text(args, 'content-type');
    const extension = filename(args).split('.').at(-1)!.toLowerCase();
    return ({ txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', pdf: 'application/pdf', zip: 'application/zip', csv: 'text/csv; charset=utf-8', html: 'text/html; charset=utf-8', svg: 'image/svg+xml' } as Record<string, string>)[extension] ?? 'application/octet-stream';
}
async function save(response: Response, artifacts: ArtifactFiles, owner: string) {
    if (!response.ok || !response.body) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Download returned no successful file body.', 502);
    const rawSize = response.headers.get('content-length'), size = rawSize === null ? NaN : Number(rawSize);
    if (Number.isSafeInteger(size) && size > 0) return artifacts.upload(owner, size, response.body);
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    try {
        while (true) {
            const part = await reader.read(); if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > 32 * 1024 * 1024) throw new ServiceError('SIZE_REQUIRED', 'Downloads above 32 MiB require an upstream Content-Length header.', 413);
            chunks.push(part.value);
        }
    } finally { await reader.cancel(); }
    if (!bytes) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'The downloaded file is empty.', 502);
    return artifacts.upload(owner, bytes, new Blob(chunks as BlobPart[]).stream());
}
export function appsTransferPrograms({ artifacts, remoteFiles }: AppsTransferDependencies): WorkflowProgram[] {
    return ['file-upload', 'file-download', 'export'].map((name) => ({ id: `apps-${name}`, version: 1, domain: 'apps', risk: name === 'file-upload' ? 'write' as const : 'read' as const, identities: ['user'] as const,
        async step(state, context) {
            const args = state.args as JsonObject;
            const preview = transferPreview(name, args);
            authorize(context.grant, { ...context.selection, domain: 'artifact', risk: name === 'file-upload' ? 'read' : 'write' }, Date.now());
            if (name === 'file-upload') {
                if (state.phase === 'prepare') {
                    const artifact = await artifacts.stat(context.grant.id, text(args, 'file'));
                    if (artifact.size > 100 * 1024 * 1024 || artifact.size < 1) invalid('Uploads must contain 1 byte to 100 MiB.');
                    const mime = contentType(args);
                    const data = await context.lark.request({ method: 'POST', path: String(preview.path), body: { file_name: filename(args), file_size: artifact.size, content_type: mime } });
                    if (!text(data, 'upload_url') || !text(data, 'upload_id')) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Upload preparation returned no URL or ID.', 502);
                    return { done: false, state: { args, phase: 'put', size: artifact.size, mime, url: data.upload_url, uploadId: data.upload_id } };
                }
                if (state.phase === 'put') {
                    const response = await artifacts.read(context.grant.id, text(args, 'file'));
                    if (!response.body) throw new ServiceError('ARTIFACT_NOT_FOUND', 'Artifact body is unavailable.', 404);
                    const name = filename(args), encoded = encodeURIComponent(name).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
                    const result = await remoteFiles.put(String(state.url), response.body, Number(state.size), { contentType: String(state.mime), contentDisposition: `attachment; filename*=UTF-8''${encoded}` });
                    return { done: false, state: { ...state, phase: 'callback', etag: result.etag ?? '' } };
                }
                if (state.phase !== 'callback') invalid('Unknown upload workflow phase.');
                const path = String(preview.path).replace(/file_pre_upload$/, 'file_upload_callback');
                const data = await context.lark.request({ method: 'POST', path, body: { upload_id: state.uploadId, etag: state.etag } });
                return { done: true, output: fileResult('file-get', { method: 'POST', path }, data) };
            }
            if (name === 'file-download' && state.phase === 'prepare') {
                const data = await context.lark.request({ method: 'POST', path: String(preview.path), body: preview.body });
                if (!text(data, 'signed_url')) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'File signing returned no URL.', 502);
                return { done: false, state: { args, phase: 'download', url: data.signed_url } };
            }
            const response = name === 'export'
                ? await (context.lark as LarkTransferClient).download({ method: 'POST', path: String(preview.path), body: preview.body })
                : await remoteFiles.stream(String(state.url), 2_000_000_000);
            const artifact = await save(response, artifacts, context.grant.id);
            return { done: true, output: { output: artifact.id, artifactId: artifact.id, size_bytes: artifact.size,
                ...(name === 'file-download' ? { path: text(args, 'path') } : text(args, 'app-id') ? { app_id: text(args, 'app-id') } : {}), ...(text(args, 'output') ? { name: text(args, 'output') } : {}) } };
        },
    }));
}

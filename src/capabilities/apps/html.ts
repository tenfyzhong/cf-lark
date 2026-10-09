import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { WorkflowProgram } from '../../ports/workflows';
import type { AppsTransferDependencies } from './transfers';
import { boundedBlob } from './db-files';
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const decoder = new TextDecoder(), encoder = new TextEncoder();
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function sensitive(path: string) { const parts = path.split('/'); return parts.some((p, i) => p === '.env' || p.startsWith('.env.') || ['.npmrc', '.netrc', '.git-credentials'].includes(p) || i > 0 && (parts[i - 1] === '.aws' && p === 'credentials' || parts[i - 1] === '.docker' && p === 'config.json' || parts[i - 1] === '.kube' && p === 'config')); }
export async function packHtml(html: Blob): Promise<Blob> {
    if (html.size > 10 * 1024 * 1024) invalid('HTML files must not exceed 10 MiB.');
    const header = new Uint8Array(512);
    const write = (offset: number, value: string) => header.set(encoder.encode(value), offset);
    write(0, 'index.html'); write(100, '0000644\0'); write(108, '0000000\0'); write(116, '0000000\0'); write(124, html.size.toString(8).padStart(11, '0') + '\0'); write(136, '00000000000\0'); header.fill(32, 148, 156); write(156, '0'); write(257, 'ustar\0'); write(263, '00');
    write(148, header.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ');
    const tar = new Blob([header, html, new Uint8Array((512 - html.size % 512) % 512 + 1024)]);
    return boundedBlob(new Response(tar.stream().pipeThrough(new CompressionStream('gzip'))), 20 * 1024 * 1024);
}
export async function validateHtmlArchive(stream: ReadableStream<Uint8Array>, allowSensitive: boolean) {
    const reader = stream.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array<ArrayBuffer>, Uint8Array>).getReader();
    let buffer = new Uint8Array(0), ended = false, consumed = 0, rawBytes = 0, files = 0, index = false;
    async function read(size: number): Promise<Uint8Array | null> {
        const out = new Uint8Array(size); let offset = 0;
        while (offset < size) {
            if (!buffer.length) { const result = await reader.read(); if (result.done) { ended = true; if (!offset) return null; invalid('Truncated tar archive.'); } buffer = result.value; }
            const n = Math.min(size - offset, buffer.length); out.set(buffer.subarray(0, n), offset); buffer = buffer.subarray(n); offset += n; consumed += n;
            if (consumed > 205 * 1024 * 1024) invalid('Uncompressed archive exceeds its bounded size.');
        }
        return out;
    }
    try {
        const seen = new Set<string>();
        while (true) {
            const header = await read(512); if (!header) break;
            if (header.every((byte) => byte === 0)) { while (!ended) { const tail = await read(512); if (tail && tail.some((byte) => byte !== 0)) invalid('Archive contains data after its end marker.'); } break; }
            const field = (start: number, length: number) => decoder.decode(header.subarray(start, start + length)).split('\0')[0]!;
            const checksum = Number.parseInt(field(148, 8).trim(), 8), sum = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0);
            if (checksum !== sum) invalid('Invalid tar checksum.');
            const prefix = field(345, 155), name = `${prefix ? `${prefix}/` : ''}${field(0, 100)}`.replace(/^\.\//, ''), type = field(156, 1);
            if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || /[\p{Cc}]/u.test(name)) invalid('Archive contains an unsafe path.');
            if (!['', '0', '5'].includes(type)) invalid('Only regular files and directories in USTAR archives are supported.');
            const sizeText = field(124, 12).trim(); if (!/^[0-7]+$/.test(sizeText)) invalid('Invalid tar size.');
            const size = Number.parseInt(sizeText, 8); if (!Number.isSafeInteger(size) || size < 0) invalid('Invalid tar size.');
            if (type !== '5') {
                if (seen.has(name)) invalid('Archive contains duplicate file paths.'); seen.add(name); files++;
                if (files > 10000) invalid('Archive contains more than 10000 files.');
                if (!allowSensitive && sensitive(name)) throw new ServiceError('SENSITIVE_FILES', 'Archive contains credential filenames; explicitly allow-sensitive to publish them.');
                if (name.toLowerCase().endsWith('.html') && size > 10 * 1024 * 1024) invalid('HTML files must not exceed 10 MiB.');
                rawBytes += size; if (rawBytes > 200 * 1024 * 1024) invalid('Uncompressed files exceed 200 MiB.');
                index ||= name === 'index.html';
            } else if (size) invalid('Directory entries must be empty.');
            let remaining = Math.ceil(size / 512) * 512;
            while (remaining) { const n = Math.min(remaining, 65536); if (!await read(n)) invalid('Truncated tar contents.'); remaining -= n; }
        }
        if (!index) throw new ServiceError('FAILED_PRECONDITION', 'Archive must contain root index.html.');
        return { files, rawBytes };
    } finally { await reader.cancel(); }
}
export function htmlPreview(args: JsonObject): JsonObject {
    const app = text(args['app-id']), artifact = text(args.path), name = text(args.name) || 'bundle.tar.gz';
    if (!/^app_[A-Za-z0-9_-]+$/.test(app) || !artifact) invalid('Provide a real app-id and path artifact.');
    if (name !== 'index.html' && !name.endsWith('.tar.gz') && !name.endsWith('.tgz')) invalid('name must be index.html or a tar.gz bundle filename.');
    return { app, artifact, name, steps: ['Validate app type', 'Validate and package owned artifact', 'GET pre_release', 'PUT bundle to presigned URL', 'POST releases'], artifactContentsValidatedDuringExecution: true };
}
export function htmlProgram({ artifacts, remoteFiles }: AppsTransferDependencies): WorkflowProgram {
    return { id: 'apps-html-publish', version: 1, domain: 'apps', risk: 'write', identities: ['user'], async step(state, context) {
        const args = state.args as JsonObject, preview = htmlPreview(args), path = `/open-apis/spark/v1/apps/${encodeURIComponent(String(preview.app))}`;
        authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
        if (state.phase === 'prepare') {
            const data = await context.lark.request({ method: 'GET', path }), app = data.app as JsonObject | undefined;
            if (!app || !text(app.app_type)) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'App metadata omitted its type.', 502);
            if (!['html', 'modern_html'].includes(text(app.app_type).toLowerCase())) throw new ServiceError('FAILED_PRECONDITION', 'This app type requires release-create instead of HTML publishing.');
            return { done: false, state: { args, phase: 'pack' } };
        }
        if (state.phase === 'pack') {
            const input = String(preview.artifact), metadata = await artifacts.stat(context.grant.id, input);
            if (metadata.size > 20 * 1024 * 1024) invalid('Compressed bundles must not exceed 20 MiB.');
            const response = await artifacts.read(context.grant.id, input);
            if (preview.name === 'index.html') {
                authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
                const packed = await packHtml(await boundedBlob(response, 10 * 1024 * 1024)), artifact = await artifacts.upload(context.grant.id, packed.size, packed.stream());
                return { done: false, state: { args, phase: 'presign', bundle: artifact.id, size: artifact.size, temporary: true } };
            }
            if (!response.body) invalid('Bundle artifact has no body.');
            await validateHtmlArchive(response.body, args['allow-sensitive'] === true);
            return { done: false, state: { args, phase: 'presign', bundle: input, size: metadata.size } };
        }
        if (state.phase === 'presign') {
            const data = await context.lark.request({ method: 'GET', path: `${path}/pre_release` });
            const kv = Object.fromEntries((Array.isArray(data.kvs) ? data.kvs : []).filter((v) => v && typeof v === 'object').map((v) => [text(v.key), text(v.value)]));
            if (!kv.upload_url || !kv.tos_path) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'pre_release omitted its upload URL or storage path.', 502);
            return { done: false, state: { ...state, phase: 'put', url: kv.upload_url, tos: kv.tos_path } };
        }
        if (state.phase === 'put') {
            const response = await artifacts.read(context.grant.id, String(state.bundle)); if (!response.body) invalid('Bundle artifact has no body.');
            await remoteFiles.put(String(state.url), response.body, Number(state.size), { contentType: 'application/gzip' });
            if (state.temporary) await artifacts.remove(context.grant.id, String(state.bundle));
            return { done: false, state: { ...state, phase: 'release' } };
        }
        if (state.phase !== 'release') invalid('Invalid HTML publication phase.');
        const data = await context.lark.request({ method: 'POST', path: `${path}/releases`, body: { tos_path: state.tos } });
        return { done: true, output: { release_id: text(data.release_id) } };
    } };
}

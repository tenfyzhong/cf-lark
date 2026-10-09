import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { DownloadRequest, LarkTransferClient } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { fileUploadProgram, saveDownloadResponse } from '../files';
import { markdownDefinitions } from './definitions';
import { compilePattern, diffMarkdown, patchMarkdown } from './transforms';
const str = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const obj = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function validate(action: string, input: JsonObject) {
    const args = { ...input };
    if (action !== 'create' && !/^[A-Za-z0-9_-]+$/.test(str(args['file-token']))) invalid('file-token must be a plain token.');
    if (action === 'create' || action === 'overwrite') {
        if (Object.hasOwn(args, 'content') === Object.hasOwn(args, 'file')) invalid('Provide exactly one content or file.');
        if (Object.hasOwn(args, 'content') && (typeof args.content !== 'string' || args.content.length === 0)) invalid('Empty Markdown files cannot be uploaded.');
        if (args.file !== undefined && !str(args.file)) invalid('file must identify a private artifact.');
        if (action === 'create' && args.content !== undefined && !str(args.name)) invalid('Inline creation requires name.');
        if (args.name !== undefined && (!str(args.name).toLowerCase().endsWith('.md') || /[\r\n\0/\\]/.test(str(args.name)))) invalid('name must be a safe .md filename.');
        if (args['folder-token'] !== undefined && args['wiki-token'] !== undefined) invalid('folder-token and wiki-token are mutually exclusive.');
        for (const key of ['folder-token', 'wiki-token']) {
            if (args[key] === undefined) continue;
            let value = str(args[key]);
            if (value.includes('://')) {
                let url: URL; try { url = new URL(value); } catch { return invalid(`Invalid ${key} URL.`); }
                const match = url.pathname.match(key === 'wiki-token' ? /^\/wiki\/([^/]+)\/?$/ : /^\/drive\/folder\/([^/]+)\/?$/);
                if (!match) invalid(`${key} URL identifies the wrong resource type.`);
                value = match[1]!;
            }
            if (!/^[A-Za-z0-9_-]+$/.test(value)) invalid(`${key} must be a plain token.`);
            args[key] = value;
        }
    }
    if (action === 'patch') {
        if (!str(args.pattern) || typeof args.content !== 'string') invalid('patch requires pattern and content, including explicit empty replacement.');
        if (args.regex) compilePattern(String(args.pattern));
    }
    if (action === 'diff') {
        for (const key of ['from-version', 'to-version']) if (args[key] !== undefined && !/^\d{1,19}$/.test(String(args[key]))) invalid(`${key} must be a numeric version string.`);
        if (!args.file && !args['from-version']) invalid('diff requires from-version or a private file artifact.');
        if (args.file && args['to-version']) invalid('to-version cannot be combined with file.');
        args['context-lines'] ??= 3;
        if (!Number.isInteger(args['context-lines']) || Number(args['context-lines']) < 0) invalid('context-lines must be nonnegative.');
    }
    return args;
}
function download(args: JsonObject, version?: unknown): DownloadRequest {
    return { path: `/open-apis/drive/v1/medias/${encodeURIComponent(str(args['file-token']))}/preview_download`, query: { preview_type: '16', ...(version ? { version } : {}) } };
}
async function readText(response: Response, maximum: number) {
    if (!response.ok || !response.body) throw new ServiceError('INVALID_DOWNLOAD', 'Markdown download returned no successful body.', 502);
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maximum) { await reader.cancel(); throw new ServiceError('CONTENT_TOO_LARGE', 'Markdown content exceeds the processing limit.', 413); }
        chunks.push(chunk.value);
    }
    return { content: await new Blob(chunks as BlobPart[]).text(), size };
}
function filename(response: Response, fallback: string) {
    const header = response.headers.get('Content-Disposition') || '', encoded = header.match(/filename\*=UTF-8''([^;]+)/i), plain = header.match(/filename="?([^";]+)"?/i);
    try { return (encoded ? decodeURIComponent(encoded[1]!) : plain?.[1])?.split(/[\\/]/).at(-1) || fallback; } catch { return fallback; }
}
function transfer(context: CommandContext) {
    const client = context.lark as LarkTransferClient;
    if (typeof client.download !== 'function') throw new ServiceError('TRANSFER_UNAVAILABLE', 'Markdown requires streaming file transport.', 500);
    return client;
}
async function stage(files: ArtifactFiles, context: CommandContext, content: string) {
    authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
    const blob = new Blob([content]); return files.upload(context.grant.id, blob.size, blob.stream());
}
async function readArtifact(files: ArtifactFiles, context: CommandContext, id: string, max: number) {
    authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
    return readText(await files.read(context.grant.id, id), max);
}
export function markdownPrograms(files: ArtifactFiles): WorkflowProgram[] {
    const upload = fileUploadProgram(files, { id: 'markdown-upload-internal', domain: 'markdown' });
    return markdownDefinitions.map((definition) => {
        const action = definition.id.slice('markdown.+'.length);
        return { id: `markdown-${action}`, version: 1, domain: 'markdown', risk: definition.risk, identities: definition.identities,
            async step(state, context) {
                const args = obj(state.args), phase = str(state.phase) || 'start';
                const next = (changes: JsonObject) => ({ done: false as const, state: { ...state, ...changes } });
                if (phase === 'upload') {
                    const result = await upload.step(obj(state.upload), context);
                    if (!result.done) return next({ upload: result.state });
                    const resultData = obj(result.output);
                    if (action === 'patch') return { done: true, output: { ...obj(state.patch), updated: true, version: resultData.version || '' } };
                    return { done: true, output: { ...resultData, size_bytes: resultData.size } };
                }
                if (phase === 'name') {
                    const response = await context.lark.request({ method: 'POST', path: '/open-apis/drive/v1/metas/batch_query', body: { request_docs: [{ doc_token: args['file-token'], doc_type: 'file' }] } });
                    const title = str(obj(Array.isArray(response.metas) ? response.metas[0] : {}).title) || `${args['file-token']}.md`;
                    return next({ phase: 'upload', upload: { phase: 'start', args: { ...obj(state.uploadArgs), name: title } } });
                }
                if (phase === 'diff-second') {
                    let second: { content: string; size: number };
                    if (args.file) second = await readArtifact(files, context, str(args.file), 10 * 1024 * 1024);
                    else second = await readText(await transfer(context).download(download(args, args['to-version'])), 10 * 1024 * 1024);
                    const first = state.firstArtifact ? await readArtifact(files, context, str(state.firstArtifact), 10 * 1024 * 1024) : { content: '', size: 0 };
                    const fromLabel = `a/${args['file-token']}@${args['from-version'] ? `version:${args['from-version']}` : 'latest'}`, toLabel = args.file ? `b/${args.file}` : `b/${args['file-token']}@${args['to-version'] ? `version:${args['to-version']}` : 'latest'}`;
                    return { done: true, output: { ...diffMarkdown(fromLabel, toLabel, first.content, second.content, Number(args['context-lines'])), mode: args.file ? 'remote_vs_local' : 'remote_vs_remote', file_token: args['file-token'], from_version: args['from-version'] || '', to_version: args['to-version'] || '', from_label: fromLabel, to_label: toLabel, context_lines: args['context-lines'], ...(args.file ? { local_file: args.file } : {}) } };
                }
                const normalized = validate(action, args);
                if (action === 'fetch') {
                    const response = await transfer(context).download(download(normalized)), name = filename(response, `${args['file-token']}.md`);
                    if (args.output) return { done: true, output: { file_token: args['file-token'], file_name: name, ...await saveDownloadResponse(files, context, response, str(args.output)) } };
                    if (!response.ok || !response.body) throw new ServiceError('INVALID_DOWNLOAD', 'Markdown download returned no successful body.', 502);
                    const reader = response.body.getReader(), prefix: Uint8Array[] = []; let size = 0, finished = false;
                    while (size <= 512 * 1024) { const part = await reader.read(); if (part.done) { finished = true; break; } prefix.push(part.value); size += part.value.byteLength; }
                    if (finished) return { done: true, output: { file_token: args['file-token'], file_name: name, content: await new Blob(prefix as BlobPart[]).text(), size_bytes: size } };
                    let index = 0;
                    const stream = new ReadableStream<Uint8Array>({
                        async pull(controller) { if (index < prefix.length) { controller.enqueue(prefix[index++]!); return; } const part = await reader.read(); if (part.done) controller.close(); else controller.enqueue(part.value); },
                        cancel(reason) { return reader.cancel(reason); },
                    });
                    const saved = await saveDownloadResponse(files, context, new Response(stream, { headers: response.headers }), name);
                    return { done: true, output: { file_token: args['file-token'], file_name: name, ...saved } };
                }
                if (action === 'diff') {
                    const payload = await readText(await transfer(context).download(download(normalized, normalized['from-version'])), 10 * 1024 * 1024);
                    const artifact = payload.size ? await stage(files, context, payload.content) : undefined;
                    return next({ args: normalized, phase: 'diff-second', ...(artifact ? { firstArtifact: artifact.id } : {}) });
                }
                let source = str(normalized.file), size = 0, patch: JsonObject | undefined;
                if (action === 'patch') {
                    const payload = await readText(await transfer(context).download(download(normalized)), 32 * 1024 * 1024), result = patchMarkdown(payload.content, String(args.pattern), String(args.content), args.regex === true);
                    patch = { updated: false, mode: args.regex ? 'regex' : 'literal', match_count: result.count, version: '', size_bytes_before: payload.size, size_bytes_after: payload.size };
                    if (!result.count) return { done: true, output: patch };
                    if (!result.content.length) invalid('Empty Markdown files cannot be uploaded.');
                    const artifact = await stage(files, context, result.content); source = artifact.id; size = artifact.size; patch.size_bytes_after = size;
                } else if (normalized.content !== undefined) { const artifact = await stage(files, context, String(normalized.content)); source = artifact.id; size = artifact.size; }
                else { authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now()); size = (await files.stat(context.grant.id, source)).size; if (!size) invalid('Empty Markdown files cannot be uploaded.'); }
                const uploadArgs: JsonObject = { file: source, ...(normalized.name ? { name: str(normalized.name) } : action === 'create' ? { name: `${source}.md` } : {}), ...(action !== 'create' ? { 'file-token': normalized['file-token'] } : {}), ...(normalized['folder-token'] ? { 'folder-token': normalized['folder-token'] } : {}), ...(normalized['wiki-token'] ? { 'wiki-token': normalized['wiki-token'] } : {}) };
                const { content: _content, ...safeArgs } = normalized;
                return next({ args: safeArgs, ...(patch ? { patch } : {}), ...(uploadArgs.name ? { phase: 'upload', upload: { phase: 'start', args: uploadArgs } } : { phase: 'name', uploadArgs }) });
            },
        };
    });
}
export function markdownCapabilities(workflows: WorkflowRunner): Capability[] {
    return markdownDefinitions.map((definition) => {
        const action = definition.id.slice('markdown.+'.length);
        return { definition,
            async preview(input) { const args = validate(action, input); return { ...(action === 'fetch' || action === 'patch' || action === 'diff' ? { download: download(args, args['from-version']) } : {}), operation: action, artifactFiles: true, ...(action === 'diff' ? { comparison: args.file || args['to-version'] || 'latest' } : {}), ...(definition.risk === 'write' ? { upload: 'Preserve the existing name or supplied .md name; use single or multipart Drive upload based on size.' } : {}) }; },
            async execute(input, context) { return workflows.start(`markdown-${action}`, { args: validate(action, input), phase: 'start' }, context.selection, context.grant); },
        };
    });
}

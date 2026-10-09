import type { RemoteFiles } from '../../ports/remote-files';
import { saveDownloadResponse } from '../files/index';
import { boxHeader, movieDuration, oggDuration } from './duration';
import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { LarkTransferClient } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { mediaSources, prepareMessage, projectMessage } from './content';
import { writeDefinitions } from './write-definitions';
export interface MessageDependencies {
    workflows: WorkflowRunner;
    artifacts?: ArtifactFiles;
    remoteFiles?: RemoteFiles;
}
const textInputs = (args: JsonObject): string[] => ['text', 'markdown', 'content'].filter(key => typeof args[key] === 'string' && String(args[key]).startsWith('@'));
async function resolveTextInputs(args: JsonObject, context: CommandContext, artifacts?: ArtifactFiles): Promise<JsonObject> {
    const keys = textInputs(args); if (!keys.length) return args;
    authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
    if (!artifacts) throw new ServiceError('UNAVAILABLE', 'Artifact content input is unavailable.', 503);
    const resolved = { ...args };
    for (const key of keys) {
        const id = String(args[key]).slice(1).replace(/^artifact:/u, '').split('/')[0]!;
        if (!id) throw new ServiceError('INVALID_ARGUMENTS', 'A content artifact ID is required.');
        const metadata = await artifacts.stat(context.grant.id, id);
        if (metadata.size > 2 * 1024 * 1024) throw new ServiceError('INVALID_ARGUMENTS', 'Message content artifacts must not exceed 2 MiB.');
        const response = await artifacts.read(context.grant.id, id);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 2 * 1024 * 1024) throw new ServiceError('INVALID_ARGUMENTS', 'Message content artifacts must not exceed 2 MiB.');
        try { resolved[key] = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { throw new ServiceError('INVALID_ARGUMENTS', 'Message content artifacts must contain valid UTF-8.'); }
    }
    return resolved;
}
export function writeCapabilities(dependencies: MessageDependencies): Capability[] {
    return writeDefinitions.map((definition) => { const action = definition.id.slice('im.+messages-'.length); return { definition, preview: async (args) => textInputs(args).length ? { deferredArtifactValidation: true, artifacts: textInputs(args).map(key => ({ argument: key, reference: args[key] })), requests: [] } : prepareMessage(action, args, true), execute: async (args, context) => {
        args = await resolveTextInputs(args, context, dependencies.artifacts);
        prepareMessage(action, args, true);
        if (mediaSources(args).length) return dependencies.workflows.start('im-message-write', { action, args, sources: mediaSources(args), offset: 0, phase: 'resolve' }, context.selection, context.grant);
        return projectMessage(await context.lark.request(prepareMessage(action, args)), action);
    } }; });
}
export function writePrograms(dependencies: Pick<MessageDependencies, 'artifacts' | 'remoteFiles'>): WorkflowProgram[] {
    return [{ id: 'im-message-write', version: 1, domain: 'im', risk: 'write', identities: ['user', 'bot'], step: async (state, context) => {
        const args = state.args as JsonObject, action = String(state.action);
        const sources = state.sources as { flag: string; value: string; image: boolean; markdown?: string }[], offset = Number(state.offset);
        if (offset >= sources.length) return { done: true, output: projectMessage(await context.lark.request(prepareMessage(action, args)), action) };
        const source = sources[offset]!;
        if (!dependencies.artifacts) throw new ServiceError('UNAVAILABLE', 'Artifact storage is unavailable.', 503);
        const artifacts = dependencies.artifacts;
        const maxBytes = (source.image ? 5 : 100) * 1024 * 1024;
        try {
            if (state.phase === 'resolve') {
                if (source.value.startsWith('artifact:')) {
                    authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
                    const [artifactID, ...parts] = source.value.slice('artifact:'.length).split('/');
                    if (!artifactID) throw new ServiceError('INVALID_ARGUMENTS', 'Artifact ID is required.');
                    const artifact = await artifacts.stat(context.grant.id, artifactID);
                    if (artifact.size <= 0 || artifact.size > maxBytes) throw new ServiceError('INVALID_ARGUMENTS', 'Media artifact exceeds the upload limit.');
                    return { done: false, state: { ...state, phase: 'upload', artifactID, filename: parts.join('/') || artifactID, temporary: false } };
                }
                authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
                if (!dependencies.remoteFiles) throw new ServiceError('UNAVAILABLE', 'Remote media downloads are unavailable.', 503);
                const downloaded = await dependencies.remoteFiles.stream(source.value, maxBytes);
                const filename = decodeURIComponent(new URL(source.value).pathname.split('/').at(-1) || 'download');
                const saved = await saveDownloadResponse(artifacts, context, downloaded, filename);
                return { done: false, state: { ...state, phase: 'upload', artifactID: saved.artifact_id, filename, temporary: true } };
            }
            authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
            const artifactID = String(state.artifactID), filename = String(state.filename);
            const artifact = await artifacts.stat(context.grant.id, artifactID);
            if (artifact.size <= 0 || artifact.size > maxBytes) throw new ServiceError('INVALID_ARGUMENTS', 'Media artifact exceeds the upload limit.');
            const client = context.lark as LarkTransferClient;
            const extension = filename.split('.').at(-1)?.toLowerCase() ?? '';
            const type = ['ogg', 'opus'].includes(extension) ? 'opus' : ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(extension) ? 'mp4' : extension === 'pdf' ? 'pdf' : ['doc', 'docx'].includes(extension) ? 'doc' : ['xls', 'xlsx', 'csv'].includes(extension) ? 'xls' : ['ppt', 'pptx'].includes(extension) ? 'ppt' : 'stream';
            if (['audio', 'video'].includes(source.flag) && !state.durationReady && ['opus', 'mp4'].includes(type)) {
                if (type === 'opus') {
                    const length = Math.min(65536, artifact.size);
                    const tail = await artifacts.read(context.grant.id, artifactID, { offset: artifact.size - length, length });
                    const duration = oggDuration(new Uint8Array(await tail.arrayBuffer()));
                    return { done: false, state: { ...state, durationReady: true, duration } };
                }
                const position = Number(state.mediaOffset ?? 0);
                if (position + 8 > artifact.size) return { done: false, state: { ...state, durationReady: true } };
                const header = await artifacts.read(context.grant.id, artifactID, { offset: position, length: Math.min(16, artifact.size - position) });
                const box = boxHeader(new Uint8Array(await header.arrayBuffer()), artifact.size - position);
                if (!box || (box.type === 'moov' && box.size - box.header > 10 * 1024 * 1024)) return { done: false, state: { ...state, durationReady: true } };
                if (box.type !== 'moov') return { done: false, state: { ...state, mediaOffset: position + box.size } };
                if (box.size === box.header) return { done: false, state: { ...state, durationReady: true } };
                const movie = await artifacts.read(context.grant.id, artifactID, { offset: position + box.header, length: box.size - box.header });
                return { done: false, state: { ...state, durationReady: true, duration: movieDuration(new Uint8Array(await movie.arrayBuffer())) } };
            }
            const response = await artifacts.read(context.grant.id, artifactID);
            if (!response.body) throw new ServiceError('UPSTREAM_ERROR', 'Artifact body is missing.', 502);
            const data = source.image
                ? await client.upload({ path: '/open-apis/im/v1/images', fields: { image_type: 'message' }, file: { field: 'image', name: filename, body: await response.blob() } })
                : await client.uploadStream({ path: '/open-apis/im/v1/files', fields: { file_type: type, file_name: filename, ...(Number(state.duration) > 0 ? { duration: String(state.duration) } : {}) }, file: { field: 'file', name: filename, size: artifact.size, body: response.body } });
            const key = data[source.image ? 'image_key' : 'file_key'];
            if (typeof key !== 'string' || !key.startsWith(source.image ? 'img_' : 'file_')) throw new ServiceError('UPSTREAM_ERROR', 'Upload response omitted a media key.', 502);
            if (source.markdown) args.markdown = String(args.markdown).replace(source.markdown, source.markdown.replace(source.value, key)); else args[source.flag] = key;
            if (state.temporary) await artifacts.remove(context.grant.id, artifactID).catch(() => undefined);
            return { done: false, state: { action, args, sources, offset: offset + 1, phase: 'resolve' } };
        } catch (error) {
            if (error instanceof ServiceError && ['FORBIDDEN', 'GRANT_EXPIRED', 'OUTCOME_UNCERTAIN'].includes(error.code)) throw error;
            if (source.markdown) { args.markdown = String(args.markdown).replace(source.markdown, ''); return { done: false, state: { action, args, sources, offset: offset + 1, phase: 'resolve' } }; }
            if (!source.value.startsWith('http') || source.flag === 'video-cover') throw error;
            for (const flag of ['image', 'file', 'video', 'video-cover', 'audio', 'msg-type']) delete args[flag];
            args.text = `[${source.flag} upload failed, sending link] ${source.value}`;
            return { done: false, state: { action, args, sources: [], offset: 0, phase: 'resolve' } };
        }
    } }];
}

import { imageDimensions } from './image-dimensions';
import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { Capability } from '../../ports/capabilities';
import type { LarkTransferClient } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { mediaUploadProgram, saveDownloadResponse } from '../files';
import { attachmentDefinitions } from './attachment-definitions';
import { attachmentMetadata } from './attachment-metadata';
import { invalid, object, parse } from './block-config';
const path = (...parts: unknown[]) => `/open-apis/base/v3/${parts.map(p => encodeURIComponent(String(p))).join('/')}`;
const str = (a: JsonObject, key: string) => String(a[key] ?? '').trim();
function list(value: unknown, optional = false): string[] {
    if (optional && value === undefined) return [];
    if (!Array.isArray(value) || (!optional && !value.length) || !value.every(v => typeof v === 'string' && v.trim())) invalid('Attachment selection must be a nonempty string array.');
    const values = value.map(v => String(v).trim()), unique = [...new Set(values)];
    if ((!optional && unique.length !== values.length) || unique.length > 50) invalid('Attachment selections must be unique and contain at most 50 values.');
    return unique;
}
function prepare(name: string, args: JsonObject): JsonObject {
    const definition = attachmentDefinitions.find(d => d.id === `base.+${name}`)!;
    for (const key of definition.inputSchema.required as string[]) if (!['json', 'file', 'file-token'].includes(key) && !str(args, key)) invalid(`${key} is required.`);
    let sources: string[] = [];
    let fields: JsonObject = {}, attachments: JsonObject = {};
    if (name === 'form-submit') {
        const raw = parse(args.json, 'json'); fields = object(raw.fields) ? raw.fields : {};
        if (!object(raw.fields) && !('attachments' in raw)) invalid('json requires fields or attachments.');
        if ('attachments' in raw) {
            if (!str(args, 'base-token') || !object(raw.attachments)) invalid('attachments requires base-token and a field-to-file object.');
            attachments = raw.attachments;
            for (const value of Object.values(attachments)) {
                if (!Array.isArray(value) || !value.length || !value.every(v => typeof v === 'string' && v.trim())) invalid('Each attachment field requires a nonempty artifact ID array.');
                sources.push(...value as string[]);
            }
            sources = [...new Set(sources)];
        }
    } else if (name.includes('upload')) {
        if ('name' in args) invalid('name is deprecated; use artifactNames for source filenames.');
        sources = list(args.file);
    } else sources = list(args['file-token'], name.includes('download'));
    const names: JsonObject = {};
    if (args.artifactNames !== undefined && !object(args.artifactNames)) invalid('artifactNames must be an object.');
    for (const source of sources) {
        const name = object(args.artifactNames) && source in args.artifactNames ? args.artifactNames[source] : source.split('/').at(-1)!;
        if (typeof name !== 'string' || !name.trim() || /[\r\n\0/\\]/u.test(name)) invalid('Artifact filenames must be safe basenames.');
        names[source] = name;
    }
    return { sources, fields, attachments, names };
}
export function attachmentCapabilities(workflows?: WorkflowRunner): Capability[] {
    return attachmentDefinitions.map(definition => ({ definition, preview: async args => ({ program: `base-${definition.id.slice(6)}`, ...prepare(definition.id.slice(6), args), note: 'Private artifact access, field resolution and media transfers happen only during execution.' }), execute: async (args, context) => {
        prepare(definition.id.slice(6), args);
        if (!workflows) throw new ServiceError('CONFIGURATION_ERROR', 'Workflow runner is not configured.', 500);
        return workflows.start(`base-${definition.id.slice(6)}`, { args, phase: 'start' }, context.selection, context.grant);
    } }));
}
function selectedDownloads(data: JsonObject, record: string, tokens: string[]): JsonObject[] {
    const attachments = object(data.attachments) ? data.attachments : {}, fields = attachments[record];
    if (!object(fields)) invalid('The record has no valid attachment metadata.');
    const byToken = new Map<string, JsonObject>();
    for (const field of Object.keys(fields).sort()) {
        const values = fields[field]; if (!Array.isArray(values)) invalid('Attachment field metadata must be an array.');
        for (const item of values) {
            if (!object(item)) invalid('Attachment metadata must be an object.');
            if (typeof item.file_token === 'string' && item.file_token && !byToken.has(item.file_token)) byToken.set(item.file_token, { ...item, field_id: field, record_id: record });
        }
    }
    if (tokens.length) return tokens.map(token => { const item = byToken.get(token); if (!item) invalid('The selected file token does not belong to this record.'); return item; });
    if (!byToken.size) invalid('The record has no attachments to download.');
    return [...byToken.values()].sort((a, b) => String(a.name || a.file_token).toLowerCase().localeCompare(String(b.name || b.file_token).toLowerCase()) || String(a.file_token).localeCompare(String(b.file_token)));
}
export function attachmentPrograms(artifacts?: ArtifactFiles): WorkflowProgram[] {
    return attachmentDefinitions.map(definition => ({ id: `base-${definition.id.slice(6)}`, version: 1, domain: 'base', risk: definition.risk, identities: definition.identities, step: async (state, context) => {
        const args = state.args as JsonObject, name = definition.id.slice(6), form = name === 'form-submit', upload = name.includes('upload') || form, download = name.includes('download');
        const pending = (patch: JsonObject) => ({ done: false as const, state: { ...state, ...patch } });
        if (state.phase === 'start') {
            const prepared = prepare(name, args);
            return pending({ ...prepared, phase: upload ? 'preflight' : download ? 'select' : 'field', index: 0, uploaded: {}, metadata: {}, downloaded: [] });
        }
        const sources = state.sources as string[], names = state.names as JsonObject, index = Number(state.index);
        if (state.phase === 'preflight') {
            if (index >= sources.length) return pending({ phase: form ? 'upload' : 'field', index: 0 });
            if (!artifacts) throw new ServiceError('CONFIGURATION_ERROR', 'Artifact files are not configured.', 500);
            authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
            const source = sources[index]!, artifact = await artifacts.stat(context.grant.id, source);
            if (artifact.size > 2 * 1024 ** 3 || artifact.size < 0) invalid('Each attachment must be at most 2 GiB.');
            const bytes = new Uint8Array(await (await artifacts.read(context.grant.id, source, { offset: 0, length: Math.min(artifact.size, 65536) })).arrayBuffer());
            const metadata = attachmentMetadata(bytes, String(names[source]));
            const dimensions = String(metadata.mime_type).startsWith('image/') ? await imageDimensions(async (offset, length) => offset + length <= bytes.length ? bytes.slice(offset, offset + length) : new Uint8Array(await (await artifacts.read(context.grant.id, source, { offset, length })).arrayBuffer()), artifact.size) : {};
            return pending({ index: index + 1, metadata: { ...(state.metadata as JsonObject), [source]: { ...metadata, ...dimensions, size: artifact.size } } });
        }
        if (state.phase === 'field') {
            const field = await context.lark.request({ method: 'GET', path: path('bases', str(args, 'base-token'), 'tables', str(args, 'table-id'), 'fields', str(args, 'field-id')) });
            const type = String(field.type || field.ui_type || field.field_type || '').toLowerCase().replaceAll('_', '').replaceAll(' ', '');
            if (!['attachment', '17'].includes(type)) invalid('The target field must be an attachment field.');
            return pending({ field: field.id || field.field_id || args['field-id'], phase: upload ? 'upload' : 'write' });
        }
        if (state.phase === 'upload') {
            if (index >= sources.length) return pending({ phase: 'write' });
            if (!artifacts) throw new ServiceError('CONFIGURATION_ERROR', 'Artifact files are not configured.', 500);
            const source = sources[index]!;
            const child = object(state.child) ? state.child : { phase: 'start', args: { file: source, name: names[source], 'parent-node': args['base-token'], 'parent-type': form ? 'bitable_tmp_point' : 'bitable_file', ...(form ? { extra: { share_token: args['share-token'] } } : {}) } };
            const result = await mediaUploadProgram(artifacts, { id: 'base-media-upload', domain: 'base' }).step(child, context);
            if (!result.done) return pending({ child: result.state });
            const output = result.output as JsonObject;
            return pending({ index: index + 1, child: null, uploaded: { ...(state.uploaded as JsonObject), [source]: { ...((state.metadata as JsonObject)[source] as JsonObject), file_token: output.file_token, name: names[source] } } });
        }
        if (state.phase === 'write') {
            let body: JsonObject;
            if (form) {
                const content = { ...(state.fields as JsonObject) };
                for (const [field, files] of Object.entries(state.attachments as JsonObject)) content[field] = (files as string[]).map(source => (state.uploaded as JsonObject)[source]);
                body = { share_token: args['share-token'], content };
            } else {
                const entries = sources.map(source => { if (!upload) return { file_token: source }; const item = (state.uploaded as JsonObject)[source] as JsonObject; return { file_token: item.file_token, ...('image_width' in item ? { image_width: item.image_width, image_height: item.image_height } : {}) }; });
                body = { attachments: { [str(args, 'record-id')]: { [String(state.field)]: entries } } };
            }
            const output = await context.lark.request({ method: 'POST', path: form ? path('bases', 'tables', 'forms', 'submit') : path('bases', str(args, 'base-token'), 'tables', str(args, 'table-id'), upload ? 'append_attachments' : 'remove_attachments'), body });
            return { done: true, output };
        }
        if (state.phase === 'select') {
            const data = await context.lark.request({ method: 'POST', path: path('bases', str(args, 'base-token'), 'tables', str(args, 'table-id'), 'get_attachments'), body: { record_id_list: [str(args, 'record-id')] } });
            return pending({ items: selectedDownloads(data, str(args, 'record-id'), sources), phase: 'download' });
        }
        if (state.phase === 'download') {
            const items = state.items as JsonObject[];
            if (index >= items.length) return { done: true, output: { downloaded: state.downloaded } };
            if (!artifacts) throw new ServiceError('CONFIGURATION_ERROR', 'Artifact files are not configured.', 500);
            const item = items[index]!, client = context.lark as LarkTransferClient;
            if (typeof client.download !== 'function') throw new ServiceError('TRANSFER_UNAVAILABLE', 'Downloads are unavailable.', 500);
            try {
                const response = await client.download({ path: `/open-apis/drive/v1/medias/${encodeURIComponent(String(item.file_token))}/download`, query: item.extra_info ? { extra: item.extra_info } : {} });
                const filename = sources.length === 1 && !str(args, 'output').endsWith('/') ? str(args, 'output').split('/').at(-1)! : String(item.name || item.file_token);
                const saved = await saveDownloadResponse(artifacts, context, response, filename);
                return pending({ index: index + 1, downloaded: [...state.downloaded as JsonObject[], { record_id: item.record_id, field_id: item.field_id, file_token: item.file_token, name: item.name || '', size: item.size ?? null, content_type: response.headers.get('Content-Type'), ...saved }] });
            } catch (error) {
                return { done: true, output: { downloaded: state.downloaded, failed: [{ record_id: item.record_id, field_id: item.field_id, file_token: item.file_token, code: error instanceof ServiceError ? error.code : 'DOWNLOAD_FAILED' }], complete: false } };
            }
        }
        throw new ServiceError('INVALID_WORKFLOW_STATE', 'Invalid Base attachment workflow phase.', 500);
    } }));
}

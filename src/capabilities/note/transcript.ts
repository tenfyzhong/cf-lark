import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactStore } from '../../ports/artifacts';
import type { Capability } from '../../ports/capabilities';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { noteDetailCapability } from './detail';
import { noteDefinitions } from './definitions';

interface Part { id: string; size: number }
interface State extends JsonObject { phase: string; args: JsonObject; parts: Part[]; page: number; cursor: string; seen: string[]; locale: string; cleanup: string[] }
function input(args: JsonObject) {
    const format = args['transcript-format'] ?? 'markdown';
    if (format !== 'markdown' && format !== 'plain_text') throw new ServiceError('INVALID_ARGUMENTS', 'transcript-format must be markdown or plain_text.');
    const filename = typeof args.output === 'string' && args.output.trim() ? args.output.trim() : `notes/${String(args['note-id']).trim()}/unified_transcript.${format === 'markdown' ? 'md' : 'txt'}`;
    if (filename.startsWith('/') || filename.includes('\\') || filename.split('/').includes('..') || /[\x00-\x1f\x7f]/u.test(filename)) throw new ServiceError('INVALID_ARGUMENTS', 'output must be a safe relative filename.');
    return { format, filename };
}
function invalid(message: string): never { throw new ServiceError('INVALID_UPSTREAM_RESPONSE', message, 502); }
function concatenate(parts: Part[], files: ArtifactStore, owner: string): ReadableStream<Uint8Array> {
    let index = 0; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            while (true) {
                if (!reader) {
                    if (index >= parts.length) { controller.close(); return; }
                    const response = await files.read(owner, parts[index++]!.id);
                    if (!response.body) invalid('A transcript part has no body.');
                    reader = response.body.getReader();
                }
                const next = await reader.read();
                if (!next.done) { controller.enqueue(next.value); return; }
                reader.releaseLock(); reader = undefined;
            }
        },
        async cancel(reason) { await reader?.cancel(reason); },
    });
}
export function noteTranscriptProgram(files: ArtifactStore): WorkflowProgram {
    return { id: 'note-transcript', version: 1, domain: 'note', risk: 'read', identities: ['user'],
        async step(raw, context) {
            authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
            authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
            const state = raw as State; const { format, filename } = input(state.args);
            const owner = context.grant.id; const id = String(state.args['note-id']).trim();
            if (state.phase === 'detail') {
                const result = await noteDetailCapability().execute(state.args, context) as { note: JsonObject };
                if (result.note.note_display_type !== 'unified') throw new ServiceError('NOT_UNIFIED_NOTE', 'Use the document fetch command for a normal note transcript.', 400,
                    { verbatim_doc_token: result.note.verbatim_doc_token });
                return { done: false, state: { ...state, phase: 'page', parts: [], cursor: '', seen: [], page: 1,
                    locale: typeof state.args.locale === 'string' && state.args.locale.trim() ? state.args.locale.trim() : context.lark.brand === 'lark' ? 'en_us' : 'zh_cn' } };
            }
            if (state.phase === 'page') {
                if (state.page > 500) invalid('Transcript exceeded the 500-page limit.');
                let data: JsonObject;
                try { data = await context.lark.request({ method: 'GET', path: `/open-apis/vc/v1/notes/${encodeURIComponent(id)}/unified_note_transcript`,
                    query: { format, locale: state.locale, page_size: 200, ...(state.cursor ? { cursor_id: state.cursor } : {}) } }); }
                catch (error) {
                    if (error instanceof ServiceError && error.details?.upstreamCode === 121005) {
                        throw new ServiceError('NOTE_PERMISSION_DENIED', 'No read permission for this note. Ask the note owner to grant access, then retry.', 403, { upstreamCode: 121005 });
                    }
                    throw error;
                }
                let cursor = '';
                if (data.has_more === true) {
                    const value = data.next_cursor_id;
                    cursor = typeof value === 'string' ? value.trim() : Number.isSafeInteger(value) && Number(value) > 0 ? String(value) : '';
                    if (!cursor || cursor === '0' || cursor === state.cursor || state.seen.includes(cursor)) invalid('Transcript pagination cursor did not advance.');
                }
                const transcript = data.transcript && typeof data.transcript === 'object' ? data.transcript as JsonObject : {};
                const content = typeof transcript[format] === 'string' ? transcript[format] as string : '';
                const parts = [...state.parts];
                if (content) {
                    const blob = new Blob([content]); const artifact = await files.upload(owner, blob.size, blob.stream());
                    parts.push({ id: artifact.id, size: artifact.size });
                }
                if (!cursor && !parts.length) throw new ServiceError('EMPTY_TRANSCRIPT', 'The note transcript is empty; no file was saved.', 502);
                return { done: false, ...(cursor ? { nextRunAt: Date.now() + 100 } : {}), state: { ...state, phase: cursor ? 'page' : 'merge', parts, page: state.page + 1,
                    cursor, seen: [...state.seen, state.cursor] } };
            }
            if (state.phase === 'cleanup') {
                for (const part of state.cleanup) await files.remove(owner, part);
                return { done: false, state: { ...state, phase: 'merge', cleanup: [] } };
            }
            if (state.phase === 'merge') {
                if (state.parts.length === 1) {
                    const part = state.parts[0]!;
                    return { done: true, output: { note_id: id, transcript_format: format, filename, transcript_file: part.id,
                        artifact_id: part.id, size_bytes: part.size, download_path: `/mcp/artifacts/${part.id}` } };
                }
                if (!state.parts.length) invalid('Transcript has no saved parts.');
                const group = state.parts.slice(0, 10); const size = group.reduce((sum, part) => sum + part.size, 0);
                const artifact = await files.upload(owner, size, concatenate(group, files, owner));
                return { done: false, state: { ...state, phase: 'cleanup', cleanup: group.map((part) => part.id),
                    parts: [{ id: artifact.id, size: artifact.size }, ...state.parts.slice(group.length)] } };
            }
            throw new ServiceError('INVALID_WORKFLOW_STATE', 'Unknown transcript phase.', 500);
        },
    };
}
export function noteTranscriptCapability(workflows: WorkflowRunner): Capability {
    return { definition: noteDefinitions.find((definition) => definition.id === 'note.+transcript')!,
        async preview(args, context) {
            const first = await noteDetailCapability().preview(args, context); const { format, filename } = input(args);
            return { requests: [first, { method: 'GET', path: `/open-apis/vc/v1/notes/${encodeURIComponent(String(args['note-id']).trim())}/unified_note_transcript`,
                query: { format, page_size: 200, locale: typeof args.locale === 'string' && args.locale.trim() ? args.locale.trim() : '{profile_brand_locale}' } }], filename,
                workflow: 'Resume until completed. Maximum 500 pages; private artifact output requires artifact read/write consent.' };
        },
        async execute(args, context) {
            await noteDetailCapability().preview(args, context); input(args);
            return workflows.start('note-transcript', { phase: 'detail', args }, context.selection, context.grant);
        },
    };
}

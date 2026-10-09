import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { noteDefinitions } from './definitions';

const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
function request(args: JsonObject): ApiRequest {
    const id = text(args['note-id']).trim();
    if (!id || id.split('/').includes('..') || /[?#%\x00-\x1f\x7f\u200b-\u200d\ufeff\u2028-\u202e\u2066-\u2069]/u.test(id)) {
        throw new ServiceError('INVALID_ARGUMENTS', 'note-id must be a safe nonempty resource name.');
    }
    return { method: 'GET', path: `/open-apis/vc/v1/notes/${encodeURIComponent(id)}` };
}
function time(value: unknown): string {
    if (value === undefined || value === null) return '';
    const raw = String(value); let number = Number.parseInt(raw, 10);
    if (!number || !Number.isSafeInteger(number)) return raw;
    if (number > 1e12) number = Math.trunc(number / 1000);
    const date = new Date(number * 1000);
    return Number.isNaN(date.getTime()) ? raw : date.toISOString().slice(0, 16).replace('T', ' ');
}
export function noteDetailCapability(): Capability {
    return { definition: noteDefinitions[0]!,
        async preview(args) { return request(args); },
        async execute(args, context) {
            let data: JsonObject;
            try { data = await context.lark.request(request(args)); }
            catch (error) {
                if (error instanceof ServiceError && error.details?.upstreamCode === 121005) {
                    throw new ServiceError('NOTE_PERMISSION_DENIED', 'No read permission for this note. Ask the note owner to grant access, then retry.', 403, { upstreamCode: 121005 });
                }
                throw error;
            }
            if (!data.note || typeof data.note !== 'object' || Array.isArray(data.note)) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'The note detail is empty.', 502);
            const note = object(data.note); const display = note.note_display_type ?? note.display_type;
            let main = ''; let verbatim = '';
            for (const entry of Array.isArray(note.artifacts) ? note.artifacts : []) {
                const artifact = object(entry);
                if (artifact.artifact_type === 1) main = text(artifact.doc_token);
                if (artifact.artifact_type === 2) verbatim = text(artifact.doc_token);
            }
            const shared = (Array.isArray(note.references) ? note.references : []).map((entry) => text(object(entry).doc_token)).filter(Boolean);
            return { note: { note_id: text(args['note-id']).trim(), note_display_type: display === 1 ? 'normal' : display === 2 ? 'unified' : 'unknown',
                creator_id: text(note.creator_id), create_time: time(note.create_time), note_doc_token: main, verbatim_doc_token: verbatim,
                ...(shared.length ? { shared_doc_tokens: shared } : {}) } };
        },
    };
}

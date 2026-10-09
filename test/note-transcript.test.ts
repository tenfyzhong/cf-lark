import { describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../src/domain/errors';
import { noteTranscriptCapability, noteTranscriptProgram } from '../src/capabilities/note/transcript';
import { fixtureFiles } from './support/file-workflow-fixtures';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';

function setup() {
    const request = vi.fn(async (_input: unknown): Promise<JsonObject> => ({ note: { note_display_type: 2 } }));
    const context: CommandContext = { lark: { request, brand: 'lark' }, selection: { profileId: 'p', accountId: 'a', identity: 'user' },
        grant: { id: crypto.randomUUID(), expiresAt: Date.now() + 60_000, revoked: false, domains: ['note', 'artifact', 'workflow'], permissions: ['read', 'write'],
            profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }] } };
    const files = { ...fixtureFiles, upload: vi.fn(fixtureFiles.upload), read: vi.fn(fixtureFiles.read), remove: vi.fn(fixtureFiles.remove) };
    return { program: noteTranscriptProgram(files), files, context, request };
}
async function advance(program: ReturnType<typeof noteTranscriptProgram>, context: CommandContext, state: JsonObject, max = 100) {
    for (let i = 0; i < max; i++) { const result = await program.step(state, context); if (result.done) return result.output as JsonObject; state = result.state; }
    throw new Error('Workflow did not finish.');
}
describe('durable note transcript', () => {
    it('schedules subsequent pages at the pinned 100 ms cadence', async () => {
        const { program, context, request } = setup();
        request.mockResolvedValue({ transcript: { markdown: 'first' }, has_more: true, next_cursor_id: 'cursor' });
        const before = Date.now();
        const result = await program.step({ phase: 'page', args: { 'note-id': 'fixture' }, parts: [], page: 1, cursor: '', seen: [], locale: 'en_us' }, context);
        expect(result.done).toBe(false);
        if (!result.done) expect(result.nextRunAt).toBeGreaterThanOrEqual(before + 100);
    });
    it('maps a transcript-page permission failure without returning a partial result', async () => {
        const { program, context, request, files } = setup();
        request.mockResolvedValueOnce({ note: { note_display_type: 2 } }).mockRejectedValueOnce(new ServiceError('UPSTREAM_ERROR', 'Denied', 403, { upstreamCode: 121005 }));
        await expect(advance(program, context, { phase: 'detail', args: { 'note-id': 'fixture' } })).rejects.toMatchObject({ code: 'NOTE_PERMISSION_DENIED' });
        expect(files.upload).not.toHaveBeenCalled();
    });
    it('previews all requests without IO and exports plain text with explicit locale and fresh artifact output', async () => {
        const { program, context, request, files } = setup();
        const start = vi.fn();
        const capability = noteTranscriptCapability({ start, resume: vi.fn() });
        const args = { 'note-id': ' fixture ', 'transcript-format': 'plain_text', locale: ' ja_jp ', output: 'exports/transcript.txt', overwrite: true };
        const preview = await capability.preview(args, context) as { requests: unknown[] };
        expect(preview.requests).toHaveLength(2);
        expect(preview.requests[1]).toMatchObject({ query: { format: 'plain_text', locale: 'ja_jp', page_size: 200 } });
        expect(request).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
        request.mockResolvedValueOnce({ note: { note_display_type: 2 } }).mockResolvedValueOnce({ transcript: { plain_text: 'Exact text' } });
        const output = await advance(program, context, { phase: 'detail', args });
        expect(request.mock.calls[1]?.[0]).toMatchObject({ query: { format: 'plain_text', locale: 'ja_jp', page_size: 200 } });
        expect(output).toMatchObject({ note_id: 'fixture', transcript_format: 'plain_text', filename: 'exports/transcript.txt', size_bytes: 10 });
        expect(await (await files.read(context.grant.id, String(output.artifact_id))).text()).toBe('Exact text');
    });
    it('paginates into a single exact artifact, keeps each step bounded and deletes intermediates', async () => {
        const { program, files, context, request } = setup();
        request.mockImplementation(async (input) => {
            const value = input as { path: string; query: { cursor_id?: string; locale: string } };
            if (!value.path.endsWith('unified_note_transcript')) return { note: { note_display_type: 2 } };
            expect(value.query.locale).toBe('en_us');
            const page = Number(value.query.cursor_id ?? 1);
            return { transcript: { markdown: `Page ${page}\n` }, has_more: page < 23, next_cursor_id: page + 1 };
        });
        let state: JsonObject = { phase: 'detail', args: { 'note-id': 'fixture' } }; let output: JsonObject | undefined;
        for (let step = 0; step < 60; step++) {
            const before = request.mock.calls.length; const reads = files.read.mock.calls.length;
            const result = await program.step(state, context);
            expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
            expect(files.read.mock.calls.length - reads).toBeLessThanOrEqual(10);
            if (result.done) { output = result.output as JsonObject; break; } state = result.state;
        }
        expect(output).toMatchObject({ note_id: 'fixture', transcript_format: 'markdown', filename: 'notes/fixture/unified_transcript.md' });
        const final = await files.read(context.grant.id, String(output?.artifact_id));
        const content = Array.from({ length: 23 }, (_, index) => `Page ${index + 1}\n`).join('');
        expect(await final.text()).toBe(content); expect(output?.size_bytes).toBe(new TextEncoder().encode(content).length);
        expect(files.remove).toHaveBeenCalledTimes(files.upload.mock.calls.length - 1);
    });
    it.each([0, '', undefined, 1.5, 9007199254740992])('rejects nonadvancing or invalid cursors before saving a partial page: %j', async (cursor) => {
        const { program, files, context, request } = setup();
        request.mockResolvedValueOnce({ note: { note_display_type: 2 } }).mockResolvedValueOnce({ transcript: { markdown: 'Partial' }, has_more: true, next_cursor_id: cursor });
        await expect(advance(program, context, { phase: 'detail', args: { 'note-id': 'fixture' } })).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
        expect(files.upload).not.toHaveBeenCalled();
    });
    it('rejects normal notes, empty transcripts and missing artifact authorization', async () => {
        const { program, files, context, request } = setup();
        request.mockResolvedValueOnce({ note: { note_display_type: 1, artifacts: [{ artifact_type: 2, doc_token: 'doc' }] } });
        await expect(advance(program, context, { phase: 'detail', args: { 'note-id': 'fixture' } })).rejects.toMatchObject({ code: 'NOT_UNIFIED_NOTE', details: { verbatim_doc_token: 'doc' } });
        request.mockResolvedValueOnce({ note: { note_display_type: 2 } }).mockResolvedValueOnce({ transcript: {}, has_more: false });
        await expect(advance(program, context, { phase: 'detail', args: { 'note-id': 'fixture' } })).rejects.toMatchObject({ code: 'EMPTY_TRANSCRIPT' });
        const denied = { ...context, grant: { ...context.grant, domains: ['note'] } };
        await expect(program.step({ phase: 'detail', args: { 'note-id': 'fixture' } }, denied)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(files.upload).not.toHaveBeenCalled();
    });
    it('detects repeated cursors and the 500-page limit without declaring completion', async () => {
        const { program, context, request } = setup();
        const state = { phase: 'page', args: { 'note-id': 'fixture' }, parts: [], page: 2, cursor: '2', seen: ['1'], locale: 'en_us' };
        request.mockResolvedValueOnce({ transcript: { markdown: 'Partial' }, has_more: true, next_cursor_id: '1' });
        await expect(program.step(state, context)).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
        await expect(program.step({ ...state, page: 501 }, context)).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
        expect(request).toHaveBeenCalledTimes(1);
    });
});

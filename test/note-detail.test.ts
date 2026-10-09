import { describe, expect, it, vi } from 'vitest';
import { noteCapabilities } from '../src/capabilities/note/commands';
import { ServiceError } from '../src/domain/errors';
import type { CommandContext } from '../src/ports/capabilities';
const fixture = () => {
    const request = vi.fn(async (): Promise<Record<string, unknown>> => ({ note: {} }));
    const context: CommandContext = { lark: { request }, selection: { profileId: 'p', identity: 'bot' },
        grant: { id: 'g', expiresAt: Date.now() + 1000, revoked: false, domains: ['note'], permissions: ['read'], profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }] } };
    return { request, context, command: noteCapabilities()[0]! };
};
describe('note detail shortcut', () => {
    it('normalizes note metadata and document tokens', async () => {
        const { request, context, command } = fixture();
        request.mockResolvedValueOnce({ note: { note_display_type: 2, creator_id: 'ou_creator', create_time: '1767225600000',
            artifacts: [{ artifact_type: 1, doc_token: 'main' }, { artifact_type: 2, doc_token: 'verbatim' }], references: [{ doc_token: 'shared' }, {}] } });
        expect(await command.preview({ 'note-id': ' fixture/id ' }, context)).toEqual({ method: 'GET', path: '/open-apis/vc/v1/notes/fixture%2Fid' });
        expect(request).not.toHaveBeenCalled();
        expect(await command.execute({ 'note-id': ' fixture/id ' }, context)).toEqual({ note: { note_id: 'fixture/id', note_display_type: 'unified', creator_id: 'ou_creator',
            create_time: '2026-01-01 00:00', note_doc_token: 'main', verbatim_doc_token: 'verbatim', shared_doc_tokens: ['shared'] } });
    });
    it.each(['', ' ', '../other', 'a/../b', '%2e%2e', 'x?y', 'x#y', 'x\u0000', 'x\u202e'])('rejects unsafe identifiers: %j', async (id) => {
        const { request, context, command } = fixture();
        await expect(command.preview({ 'note-id': id }, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(command.execute({ 'note-id': id }, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(request).not.toHaveBeenCalled();
    });
    it('rejects empty responses and maps note permission failures without disclosing upstream text', async () => {
        const { request, context, command } = fixture();
        request.mockResolvedValueOnce({});
        await expect(command.execute({ 'note-id': 'fixture' }, context)).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
        request.mockRejectedValueOnce(new ServiceError('UPSTREAM_ERROR', 'Hidden upstream detail', 502, { upstreamCode: 121005 }));
        await expect(command.execute({ 'note-id': 'fixture' }, context)).rejects.toMatchObject({ code: 'NOTE_PERMISSION_DENIED', status: 403 });
    });
    it.each([{ display_type: 1, expected: 'normal' }, { note_display_type: 1.9, expected: 'unknown' }, { note_display_type: '2', expected: 'unknown' }])('handles display type variants %j', async ({ expected, ...note }) => {
        const { request, context, command } = fixture(); request.mockResolvedValueOnce({ note });
        expect(await command.execute({ 'note-id': 'fixture' }, context)).toMatchObject({ note: { note_display_type: expected } });
    });
});

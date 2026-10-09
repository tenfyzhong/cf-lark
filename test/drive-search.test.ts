import { describe, it, expect, vi } from 'vitest';
import { driveSearchCapability } from '../src/capabilities/drive/search';
import type { CommandContext } from '../src/ports/capabilities';
const context = { selection: { profileId: 'p', accountId: 'ou_user', identity: 'user' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', accounts: ['ou_user'], identities: ['user'] }], domains: ['drive'], permissions: ['read'] }, lark: { request: vi.fn(async () => ({ res_units: [{ result_meta: { create_time: '1700000000', update_time: 1700000000000 } }], has_more: true, page_token: 'next', total: 1 })) } } satisfies CommandContext;
describe('Drive search shortcut', () => {
    it('separates owners from original creators and applies folder-only filters', async () => {
        const capability = driveSearchCapability(() => Date.parse('2026-10-09T00:00:00Z'));
        const preview = await capability.preview({ mine: true, 'original-creator-ids': 'ou_original', 'folder-tokens': 'folder', 'doc-types': 'docx,sheet', 'only-title': true, sort: 'default', 'page-size': '50' }, context) as { requests: { body: unknown }[] };
        expect(preview.requests[0]!.body).toEqual({ query: '', page_size: 20, doc_filter: { creator_ids: ['ou_user'], original_creator_ids: ['ou_original'], folder_tokens: ['folder'], doc_types: ['DOCX', 'SHEET'], only_title: true, sort_type: 'DEFAULT_TYPE' } });
    });
    it('snaps hour bounds and returns stable slices for wide opened ranges', async () => {
        const preview = await driveSearchCapability(() => Date.parse('2026-10-09T00:00:00Z')).preview({ 'edited-since': '2026-10-08T01:15:00Z', 'commented-until': '2026-10-08T01:15:00Z', 'opened-since': '180d' }, context) as any;
        expect(preview.requests[0].body.doc_filter.my_edit_time.start).toBe(Date.parse('2026-10-08T01:00:00Z') / 1000);
        expect(preview.requests[0].body.doc_filter.my_comment_time.end).toBe(Date.parse('2026-10-08T02:00:00Z') / 1000);
        expect(preview.openedSlices).toHaveLength(2);
    });
    it('preserves raw timestamps while recursively annotating seconds and milliseconds', async () => {
        expect(await driveSearchCapability().execute({}, context)).toMatchObject({ results: [{ result_meta: { create_time: '1700000000', create_time_iso: '2023-11-14T22:13:20Z', update_time_iso: '2023-11-14T22:13:20Z' } }], has_more: true });
    });
    it('rejects conflicting filters and invalid list IDs before calls', async () => {
        for (const args of [{ mine: true, 'creator-ids': 'ou_owner' }, { 'folder-tokens': 'folder', 'space-ids': '123' }, { query: 'x'.repeat(31) }, { 'chat-ids': 'ou_user' }, { 'opened-since': '366d' }]) await expect(driveSearchCapability().preview(args, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

import { describe, expect, it, vi } from 'vitest';
import { contactCapabilities } from '../src/capabilities/contact/commands';
import { ServiceError } from '../src/domain/errors';
import type { CommandContext } from '../src/ports/capabilities';

function fixture() {
    const request = vi.fn(async (_input: unknown): Promise<Record<string, unknown>> => ({ items: [] }));
    const context: CommandContext = { lark: { request, brand: 'lark' }, selection: { profileId: 'p', accountId: 'a', identity: 'user' },
        grant: { id: 'g', expiresAt: Date.now() + 60_000, revoked: false, domains: ['contact'], permissions: ['read'],
            profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }] } };
    return { command: contactCapabilities().find((item) => item.definition.id === 'contact.+search-user')!, request, context };
}
describe('contact user search', () => {
    it('maps filters and projects names, metadata, highlights and incomplete-result notices', async () => {
        const { command, request, context } = fixture();
        const args = { query: ' Alex ', 'has-chatted': true, 'exclude-external-users': true, 'left-organization': true, 'has-enterprise-email': true, 'page-size': 12 };
        const planned = { method: 'POST', path: '/open-apis/contact/v3/users/search', query: { page_size: 12 }, body: {
            query: 'Alex', filter: { has_contact: true, exclude_outer_contact: true, is_resigned: true, has_enterprise_email: true },
        } };
        expect(await command.preview(args, context)).toEqual({ requests: [planned] });
        expect(request).not.toHaveBeenCalled();
        request.mockResolvedValueOnce({ items: [{ id: 'ou_alex', display_info: '<h>Alex</h> Smith\nEngineering\n[Contacted yesterday]',
            meta_data: { i18n_names: { en_us: 'Alex', zh_cn: 'Local name' }, mail_address: 'alex@example.com', enterprise_mail_address: 'alex@work.example',
                is_registered: true, is_cross_tenant: true, chat_id: 'oc_alex', description: 'Available' } }], has_more: true, notice: 'Refine query' });
        expect(await command.execute(args, context)).toEqual({ users: [{ open_id: 'ou_alex', localized_name: 'Alex', email: 'alex@example.com',
            enterprise_email: 'alex@work.example', is_activated: true, is_cross_tenant: true, p2p_chat_id: 'oc_alex', has_chatted: true,
            department: 'Engineering', signature: 'Available', chat_recency_hint: 'Contacted yesterday', match_segments: ['Alex'] }], has_more: true, notice: 'Refine query' });
        expect(request).toHaveBeenCalledWith(planned);
    });
    it('resolves me once, deduplicates resolved IDs and keeps preview free of requests', async () => {
        const { command, request, context } = fixture();
        expect(await command.preview({ 'user-ids': 'me, ou_self,me' }, context)).toMatchObject({ resolvesCurrentUser: true });
        expect(request).not.toHaveBeenCalled();
        request.mockResolvedValueOnce({ open_id: 'ou_self' });
        await command.execute({ 'user-ids': 'me, ou_self,me' }, context);
        expect(request.mock.calls[1]?.[0]).toMatchObject({ body: { filter: { user_ids: ['ou_self'] } } });
    });
    it.each([{}, { query: 'x', 'has-chatted': false }, { query: 'x'.repeat(51) }, { query: 'x', queries: 'y' },
        { queries: 'x', 'user-ids': 'ou_x' }, { 'user-ids': 'bad' }, { queries: Array.from({ length: 21 }, (_, i) => String(i)).join(',') },
        { query: 'x', 'page-size': 31 }, { queries: ',,' }])('rejects invalid search arguments before requests: %j', async (args) => {
        const { command, request, context } = fixture();
        await expect(command.preview(args, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(command.execute(args, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(request).not.toHaveBeenCalled();
    });
    it('bounds fanout, preserves query order and partial errors, and fails an entirely unsuccessful batch', async () => {
        const { command, request, context } = fixture();
        let active = 0; let peak = 0;
        request.mockImplementation(async (input: unknown) => {
            const query = (input as { body: { query: string } }).body.query;
            active++; peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 1)); active--;
            if (query === 'bad') throw new ServiceError('UPSTREAM_ERROR', 'Query failed.', 502);
            return { items: [{ id: `ou_${query}`, meta_data: {} }], has_more: query === 'a' };
        });
        const output = await command.execute({ queries: 'a,b,bad,c,d,e,f,a' }, context) as { users: { matched_query: string }[]; queries: unknown[] };
        expect(peak).toBeLessThanOrEqual(5);
        expect(output.users.map((user) => user.matched_query)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        expect(output.queries[2]).toMatchObject({ query: 'bad', error: 'Query failed.', has_more: false });
        await expect(command.execute({ queries: 'bad' }, context)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    });
    it('uses language override, brand fallback, dictionary fallback and ID fallback deterministically', async () => {
        const { command, request, context } = fixture();
        request.mockResolvedValue({ items: [{ id: 'ou_1', meta_data: { i18n_names: { en_us: 'English', fr_fr: 'French' } } },
            { id: 'ou_2', meta_data: { i18n_names: { zz: 'Last', aa: 'First' } } }, { id: 'ou_3', meta_data: {} }] });
        const output = await command.execute({ query: 'x', lang: 'FR-fr' }, context) as { users: { localized_name: string }[] };
        expect(output.users.map((user) => user.localized_name)).toEqual(['French', 'First', 'ou_3']);
    });
});

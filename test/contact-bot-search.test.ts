import { describe, expect, it, vi } from 'vitest';
import { contactCapabilities } from '../src/capabilities/contact/commands';
import { ServiceError } from '../src/domain/errors';
import type { CommandContext } from '../src/ports/capabilities';

function fixture() {
    const request = vi.fn(async (_input: unknown): Promise<Record<string, unknown>> => ({ items: [] }));
    const context: CommandContext = { lark: { request }, selection: { profileId: 'p', accountId: 'a', identity: 'user' },
        grant: { id: 'g', expiresAt: Date.now() + 60_000, revoked: false, domains: ['contact'], permissions: ['read'],
            profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }] } };
    return { command: contactCapabilities().find((item) => item.definition.id === 'contact.+search-bot')!, request, context };
}
describe('contact bot search', () => {
    it('normalizes chat URLs before deduplication and renders decoded bot metadata', async () => {
        const { command, request, context } = fixture();
        const args = { query: ' Bot ', 'chat-ids': 'oc_a,https://tenant.feishu.cn/chat/oc_a', 'has-chatted': true };
        const plan = { method: 'POST', path: '/open-apis/bot/v4/bot/search', query: { page_size: 20 }, body: { query: 'Bot', filter: { chat_ids: ['oc_a'], has_chatter: true } } };
        expect(await command.preview(args, context)).toEqual({ requests: [plan] });
        expect(request).not.toHaveBeenCalled();
        request.mockResolvedValueOnce({ items: [{ id: 'ou_bot', display_info: '\n<h>Tools &amp; Bot</h>\nA &quot;helper&quot;',
            meta_data: { chat_id: 'oc_bot', tenant_id: 'tenant', is_agent: true, enable_join_group: true } }], has_more: true, notice: 'More matches' });
        expect(await command.execute(args, context)).toEqual({ bots: [{ open_id: 'ou_bot', name: 'Tools & Bot', description: 'A "helper"',
            chat_id: 'oc_bot', tenant_id: 'tenant', is_agent: true, enable_join_group: true, match_segments: ['Tools & Bot'] }], has_more: true, notice: 'More matches' });
        expect(request).toHaveBeenCalledWith(plan);
    });
    it.each([{}, { 'has-chatted': true }, { query: 'x', 'has-chatted': false }, { query: 'x', 'chat-ids': 'invalid' },
        { query: 'x', queries: 'y' }, { queries: ',,' }, { query: 'x'.repeat(51) }, { query: 'x', 'page-size': 0 }])('rejects invalid arguments before requests: %j', async (args) => {
        const { command, request, context } = fixture();
        await expect(command.preview(args, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(command.execute(args, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(request).not.toHaveBeenCalled();
    });
    it('retains ordered partial API failures but propagates terminal failures', async () => {
        const { command, request, context } = fixture();
        request.mockImplementation(async (input) => {
            const query = (input as { body: { query: string } }).body.query;
            if (query === 'bad') throw new ServiceError('UPSTREAM_ERROR', 'Upstream failure.', 502);
            if (query === 'denied') throw new ServiceError('FORBIDDEN', 'Authorization revoked.', 403);
            return { items: [{ id: `ou_${query}`, display_info: query }] };
        });
        const output = await command.execute({ queries: 'a,bad,b,a' }, context) as { bots: { matched_query: string }[]; queries: unknown[] };
        expect(output.bots.map((bot) => bot.matched_query)).toEqual(['a', 'b']);
        expect(output.queries[1]).toMatchObject({ query: 'bad', error: 'Upstream failure.' });
        await expect(command.execute({ queries: 'a,denied' }, context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(command.execute({ queries: 'bad' }, context)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    });
});

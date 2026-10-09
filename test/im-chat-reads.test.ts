import { expect, it, vi } from 'vitest';
import { imCapabilities, imPrograms } from '../src/capabilities/im/commands';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
it('normalizes chat search modes and queries, paginates metadata, then filters mute status', async () => {
    const request = vi.fn(async (_: unknown): Promise<JsonObject> => ({}));
    const context: CommandContext = { lark: { request }, selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: 1, revoked: false, profiles: [], domains: [], permissions: [] } };
    const start = vi.fn();
    const command = imCapabilities({ workflows: { start, resume: vi.fn() } }).find((item) => item.definition.id === 'im.+chat-search')!;
    await command.execute({ query: 'test-team', 'chat-modes': 'topic,group,topic', sort: 'member_count', 'page-all': true, 'exclude-muted': true }, context);
    request.mockResolvedValueOnce({ items: [{ meta_data: { chat_id: 'oc_a' } }], notice: 'Limited query', total: 3, has_more: true, next_page_token: 'next' })
        .mockResolvedValueOnce({ items: [{ meta_data: { chat_id: 'oc_b' } }, { meta_data: { chat_id: 'oc_c' } }], total: 3, has_more: false })
        .mockResolvedValueOnce({ items: [{ chat_id: 'oc_a', is_muted: true }, { chat_id: 'oc_b', is_muted: false }], invalid_id_list: [{ id: 'oc_c' }] });
    let state = start.mock.calls[0]![1] as JsonObject;
    const program = imPrograms().find((item) => item.id === start.mock.calls[0]![0])!;
    let output: unknown;
    for (let i = 0; i < 10; i++) { const result = await program.step(state, context); if (result.done) { output = result.output; break; } state = result.state; }
    expect(request.mock.calls[0]).toMatchObject([{ body: { query: '"test-team"', filter: { chat_modes: ['thread', 'default'] }, sorter: 'member_count_desc' } }]);
    expect(output).toMatchObject({ chats: [{ chat_id: 'oc_b' }, { chat_id: 'oc_c' }], notice: 'Limited query', total: 3, filter: { fetched_count: 3, filtered_count: 1, returned_count: 2 } });
});
it('rejects bot-only p2p and reports mixed-type adjustment in preview', async () => {
    const command = imCapabilities({ workflows: { start: vi.fn(), resume: vi.fn() } }).find((item) => item.definition.id === 'im.+chat-list')!;
    const context = { selection: { profileId: 'p', identity: 'bot' as const }, grant: { id: 'g', expiresAt: 1, revoked: false, profiles: [], domains: [], permissions: [] } };
    await expect(command.preview({ types: ['p2p'] }, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(await command.preview({ types: ['p2p', 'group'], 'sort-type': 'ByActiveTimeDesc' }, context)).toMatchObject({ request: { query: { types: 'group', sort_type: 'ByActiveTimeDesc' } }, notices: [{ code: 'bot_strip_p2p' }] });
});

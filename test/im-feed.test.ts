import { expect, it, vi } from 'vitest';
import { imCapabilities, imPrograms } from '../src/capabilities/im/commands';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
function setup() {
    const request = vi.fn(async (): Promise<JsonObject> => ({}));
    const context: CommandContext = { lark: { request, brand: 'feishu' }, selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [], domains: ['im'], permissions: ['read', 'write'] } };
    const workflows = { start: vi.fn(async (program: string, state: JsonObject) => ({ workflowId: program, selection: context.selection, status: 'pending' as const, output: state })), resume: vi.fn() };
    const command = (name: string) => imCapabilities({ workflows }).find((item) => item.definition.id === `im.+${name}`)!;
    return { request, context, workflows, command };
}
it('creates chats with validated member IDs and retains success when share lookup fails', async () => {
    const { request, context, command } = setup();
    request.mockResolvedValueOnce({ chat_id: 'oc_new', name: 'Team', external: false }).mockRejectedValueOnce(new Error('No permission'));
    const args = { name: 'Team', users: 'ou_one, ou_two', bots: 'cli_bot', type: 'public', 'chat-mode': 'topic' };
    expect(await command('chat-create').execute(args, context)).toMatchObject({ chat_id: 'oc_new', name: 'Team', chat_app_link: 'https://applink.feishu.cn/client/chat/open?openChatId=oc_new' });
    expect(request.mock.calls[0]).toEqual([{ method: 'POST', path: '/open-apis/im/v1/chats', query: { user_id_type: 'open_id' }, body: { name: 'Team', user_id_list: ['ou_one', 'ou_two'], bot_id_list: ['cli_bot'], chat_type: 'public', chat_mode: 'topic' } }]);
    await expect(command('chat-create').preview({ 'set-bot-manager': true }, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(command('chat-update').execute({ 'chat-id': 'oc_a', description: '' }, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(request).toHaveBeenCalledTimes(2);
});
it('deduplicates feed shortcut IDs and accounts for duplicate or unrelated failures', async () => {
    const { request, context, command } = setup();
    request.mockResolvedValue({ failed_shortcuts: [{ shortcut: { feed_card_id: 'oc_b' }, reason: 1 }, { shortcut: { feed_card_id: 'oc_b' }, reason: 1 }] });
    expect(await command('feed-shortcut-create').execute({ 'chat-id': ['oc_a,oc_b', 'oc_a'], tail: true }, context)).toMatchObject({ total: 2, success_count: 1, failure_count: 1, succeeded_shortcuts: [{ feed_card_id: 'oc_a', type: 1 }], failed_shortcuts: [{ reason_label: 'no_permission' }, { reason_label: 'no_permission' }] });
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/open-apis/im/v2/feed_shortcuts', body: { shortcuts: [{ feed_card_id: 'oc_a', type: 1 }, { feed_card_id: 'oc_b', type: 1 }], is_header: false } });
    await expect(command('feed-shortcut-create').preview({ 'chat-id': ['oc_a'], head: true, tail: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('checkpoints dual-array pagination and enriches active and deleted items in bounded steps', async () => {
    const { request, context, workflows, command } = setup();
    await command('feed-group-list-item').execute({ 'feed-group-id': 'group/a', 'page-all': true }, context);
    const [id, initial] = workflows.start.mock.calls[0]!;
    const program = imPrograms().find((item) => item.id === id)!;
    request.mockResolvedValueOnce({ items: [{ feed_id: 'oc_a' }], deleted_items: [{ feed_id: 'oc_b' }], has_more: true, page_token: 'next' })
        .mockResolvedValueOnce({ items: [{ feed_id: 'oc_c' }], deleted_items: [], has_more: false, page_token: '' })
        .mockResolvedValueOnce({ items: [{ chat_id: 'oc_a', name: 'A' }, { chat_id: 'oc_b', name: 'B' }, { chat_id: 'oc_c', name: 'C' }] });
    let state = initial;
    let output: unknown;
    for (let i = 0; i < 8; i++) {
        const before = request.mock.calls.length;
        const step = await program.step(state, context);
        expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
        if (step.done) { output = step.output; break; }
        state = step.state;
    }
    expect(output).toMatchObject({ items: [{ feed_id: 'oc_a', chat_name: 'A' }, { feed_id: 'oc_c', chat_name: 'C' }], deleted_items: [{ feed_id: 'oc_b', chat_name: 'B' }], has_more: false });
    expect(request.mock.calls[0]).toMatchObject([{ path: '/open-apis/im/v1/groups/group%2Fa/list_item' }]);
});

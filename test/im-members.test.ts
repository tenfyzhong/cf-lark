import { expect, it, vi } from 'vitest';
import { imCapabilities, imPrograms } from '../src/capabilities/im/commands';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
const request = vi.fn(async (_: unknown): Promise<JsonObject> => ({}));
const context: CommandContext = { lark: { request }, selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: 1, revoked: false, profiles: [], domains: [], permissions: [] } };
it('validates batched read-status IDs and normalizes reader result counts', async () => {
    const capabilities = imCapabilities({ workflows: { start: vi.fn(), resume: vi.fn() } });
    const command = (name: string) => capabilities.find((item) => item.definition.id === `im.+${name}`)!;
    await command('messages-read-status').execute({ 'message-id': 'om_a,om_b' }, context);
    expect(request).toHaveBeenLastCalledWith({ method: 'POST', path: '/open-apis/im/v1/messages/read_status', body: { message_ids: ['om_a', 'om_b'] } });
    await expect(command('messages-read-status').preview({ 'message-ids': 'oc_a' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    request.mockResolvedValueOnce({ items: [{ user_id: 'ou_a' }], has_more: true, page_token: 'next' });
    expect(await command('message-read-users').execute({ 'message-id': 'om_a' }, context)).toEqual({ items: [{ user_id: 'ou_a' }], has_more: true, page_token: 'next', total: 1 });
});
it('retains both member buckets and last-page truncation signals across workflow steps', async () => {
    const start = vi.fn();
    const capability = imCapabilities({ workflows: { start, resume: vi.fn() } }).find((item) => item.definition.id === 'im.+chat-members-list')!;
    await capability.execute({ 'chat-id': 'oc_a', 'page-all': true, 'page-limit': 0, 'member-types': ['USER', 'bot'] }, context);
    let state = start.mock.calls[0]![1] as JsonObject;
    const program = imPrograms().find((item) => item.id === start.mock.calls[0]![0])!;
    request.mockResolvedValueOnce({ users: [{ member_id: 'ou_a' }], bots: [{ member_id: 'cli_a' }], has_more: true, page_token: 'next', user_total: 9 })
        .mockResolvedValueOnce({ users: [{ member_id: 'ou_b' }], bots: [], has_more: false, truncations: [{ member_type: 'user', limit: 2 }], user_total: 10 });
    const first = await program.step(state, context);
    expect(first.done).toBe(false);
    if (!first.done) state = first.state;
    expect(await program.step(state, context)).toMatchObject({ done: true, output: { chat_id: 'oc_a', users: [{ member_id: 'ou_a' }, { member_id: 'ou_b' }], bots: [{ member_id: 'cli_a' }], user_total: 10, truncations: [{ member_type: 'user', limit: 2 }] } });
    expect(request.mock.calls.at(-2)).toMatchObject([{ query: { page_size: 100, member_types: 'user,bot' } }]);
});

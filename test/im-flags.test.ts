import { expect, it, vi } from 'vitest';
import { imCapabilities, imPrograms } from '../src/capabilities/im/commands';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
function setup() {
    const request = vi.fn(async (_: unknown): Promise<JsonObject> => ({}));
    const context: CommandContext = { lark: { request }, selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: 1, revoked: false, profiles: [], domains: [], permissions: [] } };
    const start = vi.fn();
    const command = (name: string) => imCapabilities({ workflows: { start, resume: vi.fn() } }).find((item) => item.definition.id === `im.+${name}`)!;
    async function drain() {
        const [programID, initial] = start.mock.calls.at(-1)!;
        const program = imPrograms().find((item) => item.id === programID)!;
        let state: JsonObject = initial;
        for (let i = 0; i < 20; i++) {
            const before = request.mock.calls.length;
            const result = await program.step(state, context);
            expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
            if (result.done) return result.output;
            state = result.state;
        }
        throw new Error('Workflow did not finish.');
    }
    return { request, context, command, drain };
}
it('infers topic feed flags and independently cancels both layers', async () => {
    const { request, context, command, drain } = setup();
    request.mockResolvedValueOnce({ items: [{ chat_id: 'oc_a' }] }).mockResolvedValueOnce({ chat_mode: 'topic' }).mockResolvedValueOnce({});
    await command('flag-create').execute({ 'message-id': 'om_a', 'flag-type': 'feed' }, context);
    await drain();
    expect(request).toHaveBeenLastCalledWith({ method: 'POST', path: '/open-apis/im/v1/flags', body: { flag_items: [{ item_id: 'om_a', item_type: '4', flag_type: '1' }] } });
    request.mockResolvedValueOnce({ items: [{ chat_id: 'oc_a' }] }).mockResolvedValueOnce({ chat_mode: 'group' }).mockRejectedValueOnce(new Error('Rejected')).mockResolvedValueOnce({});
    await command('flag-cancel').execute({ 'message-id': 'om_a' }, context);
    expect(await drain()).toMatchObject({ results: [{ item_type: 'default', flag_type: 'message', status: 'failed' }, { item_type: 'msg_thread', flag_type: 'feed', status: 'ok' }], ok: false });
});
it('validates explicit pairs and enriches active flags while retaining deleted entries', async () => {
    const { request, context, command, drain } = setup();
    await expect(command('flag-create').preview({ 'message-id': 'om_a', 'item-type': 'thread' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    request.mockResolvedValueOnce({ flag_items: [{ item_id: 'om_a', item_type: '4', flag_type: '1' }], delete_flag_items: [{ item_id: 'om_old' }], messages: [], has_more: false }).mockResolvedValueOnce({ items: [{ message_id: 'om_a', body: { content: 'text' } }] });
    await command('flag-list').execute({}, context);
    expect(await drain()).toMatchObject({ flag_items: [{ message: { message_id: 'om_a' } }], delete_flag_items: [{ item_id: 'om_old' }] });
    expect(request).toHaveBeenLastCalledWith({ method: 'GET', path: '/open-apis/im/v1/messages/mget', query: { message_ids: ['om_a'] }, queryEncoding: { message_ids: 'repeat' } });
});

import { expect, it, vi } from 'vitest';
import { createReadProgram } from '../src/capabilities/im/read';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
const context: CommandContext = { lark: { request: vi.fn() }, selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: 1, revoked: false, profiles: [], domains: [], permissions: [] } };
it('formats raw interactive cards through the isolated converter', async () => {
    const format = vi.fn(async () => '<card title="Status">Ready</card>');
    const program = createReadProgram(undefined, { format });
    const result = await program.step({ name: 'messages-mget', args: {}, phase: 'format', raw: [{ message_id: 'om_card', msg_type: 'interactive', body: { content: '{"json_card":"{}"}' }, mentions: [{ key: 'k', name: 'Sam' }] }] }, context);
    expect(result.done).toBe(false);
    if (!result.done) expect((result.state.messages as JsonObject[])[0]!.content).toBe('<card title="Status">Ready</card>');
    expect(format).toHaveBeenCalledWith('{"json_card":"{}"}', [{ key: 'k', name: 'Sam' }]);
});
it('does not claim successful card formatting when the converter is absent', async () => {
    await expect(createReadProgram().step({ name: 'messages-mget', args: {}, phase: 'format', raw: [{ msg_type: 'interactive', body: { content: '{}' } }] }, context)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
it('reuses producer sender names within a page without mention-name inference', async () => {
    const result = await createReadProgram().step({ name: 'messages-mget', args: {}, phase: 'format', raw: [{ msg_type: 'text', body: { content: '{"text":"a"}' }, sender: { id: 'ou_a', sender_name: 'Sam' } }, { msg_type: 'text', body: { content: '{"text":"b"}' }, sender: { id: 'ou_a' } }] }, context);
    if (result.done) throw new Error('Expected checkpoint');
    expect((result.state.messages as JsonObject[])[1]!.sender).toEqual({ id: 'ou_a', name: 'Sam' });
});

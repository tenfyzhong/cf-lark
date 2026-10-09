import { expect, it, vi } from 'vitest';
import { eventSubscribeCapability } from '../src/capabilities/event/consume';
import type { CommandContext } from '../src/ports/capabilities';
import type { ArtifactStore } from '../src/ports/artifacts';
const ctx: CommandContext = { lark: { request: vi.fn() }, selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', accounts: [], identities: ['bot'] }], domains: ['event', 'artifact'], permissions: ['read', 'write'] } };
const event = (sequence: number, type: string, value = {}) => ({ sequence, id: `e${sequence}`, type, payload: { schema: '2.0', header: { event_id: `e${sequence}`, event_type: type, create_time: '100' }, event: value } });
it('advances the scanned durable cursor even when filters remove events', async () => {
    const read = vi.fn(async () => ({ cursor: 3, events: [event(1, 'contact.user.created_v3'), event(2, 'im.message.reaction.created_v1', { message_id: 'm', reaction_type: { emoji_type: 'LOVE' }, user_id: { open_id: 'ou_a' } }), event(3, 'im.chat.updated_v1')] }));
    const command = eventSubscribeCapability({ read }, {} as ArtifactStore);
    const result = await command.execute({ cursor: 0, 'event-types': 'im.message.reaction.created_v1', filter: '^im\\.', compact: true }, ctx);
    expect(result).toMatchObject({ cursor: 3, events: [{ sequence: 2, data: { type: 'im.message.reaction.created_v1', event_id: 'e2', action: 'added', emoji_type: 'LOVE', operator_id: 'ou_a' } }] });
    expect(read).toHaveBeenCalledWith('p', 0, 50);
    expect(ctx.lark.request).not.toHaveBeenCalled();
});
it('routes every matching destination to private artifacts and retains raw envelope', async () => {
    const read = vi.fn(async () => ({ cursor: 1, events: [event(1, 'im.chat.updated_v1', { chat_id: 'c' })] }));
    const saved: string[] = [];
    const upload = vi.fn(async (_owner: string, _size: number, body: ReadableStream<Uint8Array>) => { saved.push(await new Response(body).text()); return { id: `a${saved.length}`, size: 10, expiresAt: 1 }; });
    const command = eventSubscribeCapability({ read }, { upload } as unknown as ArtifactStore);
    const result = await command.execute({ route: ['^im\\.=dir:im', 'chat=dir:chats'], json: true }, ctx);
    expect(result).toMatchObject({ events: [{ artifacts: [{ id: 'a1', directory: 'im' }, { id: 'a2', directory: 'chats' }] }] });
    expect(JSON.parse(saved[0]!)).toMatchObject({ schema: '2.0', header: { event_id: 'e1' }, event: { chat_id: 'c' } });
});
it('validates RE2 syntax and routes before reading, permits linear nested quantifiers', async () => {
    const read = vi.fn();
    const command = eventSubscribeCapability({ read }, {} as ArtifactStore);
    await expect(command.preview({ filter: '(?=x)' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(command.preview({ route: ['x=dir:../unsafe'] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(command.preview({ filter: '(a+)+$' })).resolves.toBeDefined();
    expect(read).not.toHaveBeenCalled();
});
it('compacts received messages through the canonical IM converter and strips callback secrets', async () => {
    const read = vi.fn(async () => ({ cursor: 1, events: [{ ...event(1, 'im.message.receive_v1', { sender: { sender_id: { open_id: 'ou_sender' }, sender_type: 'user' }, message: { message_id: 'm', message_type: 'text', content: '{"text":"Hello"}', create_time: '99', parent_id: 'parent' } }), payload: { schema: '2.0', header: { event_id: 'e1', token: 'verification-secret' }, event: { sender: { sender_id: { open_id: 'ou_sender' }, sender_type: 'user' }, message: { message_id: 'm', message_type: 'text', content: '{"text":"Hello"}', create_time: '99', parent_id: 'parent' } } } }] }));
    const command = eventSubscribeCapability({ read }, {} as ArtifactStore);
    expect(await command.execute({ compact: true }, ctx)).toMatchObject({ events: [{ data: { content: 'Hello', id: 'm', sender_id: 'ou_sender', reply_to: 'parent', timestamp: '99' } }] });
    expect(JSON.stringify(await command.execute({}, ctx))).not.toContain('verification-secret');
});

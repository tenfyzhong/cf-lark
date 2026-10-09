import { expect, it, vi } from 'vitest';
import { readCapabilities, readProgram } from '../src/capabilities/im/read';
import type { JsonObject } from '../src/domain/models';
import type { CommandContext } from '../src/ports/capabilities';
it('resolves a P2P target and converts messages with requested sender names', async () => {
    const start = vi.fn();
    const command = readCapabilities({ start, resume: vi.fn() }).find((item) => item.definition.id === 'im.+chat-messages-list')!;
    const request = vi.fn(async (_: unknown): Promise<JsonObject> => ({}));
    const context: CommandContext = { lark: { request }, selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: 1, revoked: false, profiles: [], domains: [], permissions: [] } };
    await command.execute({ 'user-id': 'ou_a', 'no-reactions': true }, context);
    request.mockResolvedValueOnce({ p2p_chats: [{ chat_id: 'oc_a' }] }).mockResolvedValueOnce({ items: [{ message_id: 'om_a', msg_type: 'text', body: { content: '{"text":"Hello"}' }, sender: { id: 'ou_a', sender_name: 'Sam' } }], has_more: false });
    let state = start.mock.calls[0]![1] as JsonObject, output: unknown;
    for (let i = 0; i < 12; i++) { const result = await readProgram.step(state, context); if (result.done) { output = result.output; break; } state = result.state; }
    expect(output).toMatchObject({ messages: [{ message_id: 'om_a', content: 'Hello', sender: { name: 'Sam' } }], chat_id: 'oc_a' });
    expect(request.mock.calls[1]).toMatchObject([{ query: { container_id: 'oc_a', container_id_type: 'chat', with_sender_name: true } }]);
});
it('validates search filters before execution and falls back to IDs if full lookup fails', async () => {
    const start = vi.fn(), command = readCapabilities({ start, resume: vi.fn() }).find((item) => item.definition.id === 'im.+messages-search')!;
    await expect(command.preview({ 'sender-type': 'user', 'exclude-sender-type': 'user' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    const request = vi.fn(async (_: unknown): Promise<JsonObject> => ({}));
    const context: CommandContext = { lark: { request }, selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: 1, revoked: false, profiles: [], domains: [], permissions: [] } };
    await command.execute({ query: 'report' }, context);
    request.mockResolvedValueOnce({ items: [{ meta_data: { message_id: 'om_a' } }], has_more: false, notice: 'Query notice' }).mockRejectedValueOnce(new Error('Unavailable'));
    let state = start.mock.calls[0]![1] as JsonObject, output: unknown;
    for (let i = 0; i < 8; i++) { const result = await readProgram.step(state, context); if (result.done) { output = result.output; break; } state = result.state; }
    expect(output).toMatchObject({ message_ids: ['om_a'], notice: 'Query notice', note: 'failed to fetch message details, returning ID list only' });
});
it('expands thread replies once per thread and enriches reactions on replies', async () => {
    const start = vi.fn(), command = readCapabilities({ start, resume: vi.fn() }).find((item) => item.definition.id === 'im.+messages-mget')!;
    const request = vi.fn(async (_: unknown): Promise<JsonObject> => ({}));
    const context: CommandContext = { lark: { request }, selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: 1, revoked: false, profiles: [], domains: [], permissions: [] } };
    await command.execute({ 'message-ids': 'om_a,om_b' }, context);
    request.mockResolvedValueOnce({ items: [{ message_id: 'om_a', thread_id: 'omt_a', msg_type: 'text', body: { content: '{"text":"Root"}' } }, { message_id: 'om_b', thread_id: 'omt_a', msg_type: 'text', body: { content: '{"text":"Other"}' } }] })
        .mockResolvedValueOnce({ items: [{ message_id: 'om_reply', msg_type: 'text', body: { content: '{"text":"Reply"}' } }], has_more: true })
        .mockResolvedValueOnce({ success_msg_reaction_counts: [{ message_id: 'om_reply', reaction_count: [{ reaction_type: 'SMILE', count: 1 }] }] });
    let state = start.mock.calls[0]![1] as JsonObject, output: unknown;
    for (let i = 0; i < 20; i++) { const result = await readProgram.step(state, context); if (result.done) { output = result.output; break; } state = result.state; }
    expect(output).toMatchObject({ messages: [{ message_id: 'om_a', thread_has_more: true, thread_replies: [{ content: 'Reply', reactions: { counts: [{ count: 1 }] } }] }, { message_id: 'om_b' }] });
    expect(request.mock.calls.filter(([input]) => (input as { query?: JsonObject }).query?.container_id_type === 'thread')).toHaveLength(1);
});
it('expands merged-forward children and folder entries before returning content', async () => {
    const start = vi.fn(), command = readCapabilities({ start, resume: vi.fn() }).find((item) => item.definition.id === 'im.+messages-mget')!;
    const request = vi.fn(async (_: unknown): Promise<JsonObject> => ({}));
    const context: CommandContext = { lark: { request }, selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: 1, revoked: false, profiles: [], domains: [], permissions: [] } };
    await command.execute({ 'message-ids': 'om_merge,om_folder', 'no-reactions': true }, context);
    request.mockResolvedValueOnce({ items: [{ message_id: 'om_merge', msg_type: 'merge_forward', body: { content: 'Merged messages' } }, { message_id: 'om_folder', msg_type: 'folder', body: { content: '{"file_key":"file_folder","file_name":"Assets"}' } }] })
        .mockResolvedValueOnce({ items: [{ message_id: 'om_child', upper_message_id: 'om_merge', msg_type: 'text', body: { content: '{"text":"Forwarded"}' }, sender: { id: 'ou_a', sender_name: 'Sam' }, create_time: '1000' }] })
        .mockResolvedValueOnce({ items: [{ file_key: 'file_child', name: 'report.pdf', is_folder: false }], all_count: 1 });
    let state = start.mock.calls[0]![1] as JsonObject, output: JsonObject = {};
    for (let i = 0; i < 20; i++) { const result = await readProgram.step(state, context); if (result.done) { output = result.output as JsonObject; break; } state = result.state; }
    const messages = output.messages as JsonObject[];
    expect(messages[0]!.content).toContain('<forwarded_messages>');
    expect(messages[0]!.content).toContain('Sam:\n    Forwarded');
    expect(messages[1]!.content).toBe('<folder key="file_folder" name="Assets" child_count="1"><file key="file_child" name="report.pdf"/></folder>');
});
it('downloads resource refs without dropping message data and returns concise Markdown', async () => {
    const { createReadProgram } = await import('../src/capabilities/im/read');
    const start = vi.fn(), command = readCapabilities({ start, resume: vi.fn() }).find((item) => item.definition.id === 'im.+chat-messages-list')!;
    const request = vi.fn(async (_: unknown): Promise<JsonObject> => ({ items: [{ message_id: 'om_image', msg_type: 'image', body: { content: '{"image_key":"img_a"}' } }] }));
    const download = vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'content-length': '1' } }));
    const artifacts = { upload: vi.fn(async () => ({ id: 'artifact', owner: 'g', size: 1, expiresAt: 9, state: 'ready' as const })), read: vi.fn(), remove: vi.fn(), stat: vi.fn() };
    const context: CommandContext = { lark: { request, ...{ download } }, selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }], domains: ['im', 'artifact'], permissions: ['read', 'write'] } };
    await command.execute({ 'chat-id': 'oc_a', 'no-reactions': true, 'download-resources': true, concise: true }, context);
    let state = start.mock.calls[0]![1] as JsonObject, output: JsonObject = {};
    const program = createReadProgram(artifacts);
    for (let i = 0; i < 20; i++) { const result = await program.step(state, context); if (result.done) { output = result.output as JsonObject; break; } state = result.state; }
    expect(output).toMatchObject({ messages: [{ resources: [{ key: 'img_a', artifact_id: 'artifact', size_bytes: 1 }] }] });
    expect(output.concise_markdown).toContain('om\\_image');
    expect(download).toHaveBeenCalledOnce();
});
it('honors explicit page delay without blocking a Worker or fetching early', async () => {
    const start = vi.fn(), command = readCapabilities({ start, resume: vi.fn() }).find((item) => item.definition.id === 'im.+chat-messages-list')!;
    const request = vi.fn(async (_: unknown): Promise<JsonObject> => ({ items: [], has_more: true, page_token: 'next' }));
    const context: CommandContext = { lark: { request }, selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: 1, revoked: false, profiles: [], domains: [], permissions: [] } };
    await command.execute({ 'chat-id': 'oc_a', 'page-all': true, 'page-delay': 60000 }, context);
    const first = await readProgram.step(start.mock.calls[0]![1] as JsonObject, context);
    expect(first.done).toBe(false);
    if (first.done) return;
    const pending = await readProgram.step(first.state, context);
    expect(pending.done).toBe(false);
    expect(request).toHaveBeenCalledOnce();
});

it('advertises bot search identity and the dedicated message search scope', () => {
    const definition = readCapabilities({ start: vi.fn(), resume: vi.fn() }).find((item) => item.definition.id === 'im.+messages-search')!.definition;
    expect(definition.identities).toEqual(['user', 'bot']);
    expect(definition.scopes).toEqual(['search:message', 'im:message.reactions:read']);
});
it('accepts Unix bounds and includes the complete end date', async () => {
    const command = readCapabilities({ start: vi.fn(), resume: vi.fn() }).find(item => item.definition.id === 'im.+chat-messages-list')!;
    expect(await command.preview({ 'chat-id': 'oc_a', start: '1767225600', end: '2026-01-31' })).toMatchObject({ request: { query: { start_time: '1767225600', end_time: '1769903999' } } });
});
it('enables search pagination from page-limit and preserves the first notice', async () => {
    const request = vi.fn().mockResolvedValueOnce({ items: [], has_more: true, page_token: 'next', notice: 'First' }).mockResolvedValueOnce({ items: [], has_more: false, notice: 'Second' });
    const context: CommandContext = { lark: { request }, selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', expiresAt: 1, revoked: false, profiles: [], domains: [], permissions: [] } };
    const first = await readProgram.step({ name: 'messages-search', args: { query: 'x', 'page-size': 20, 'page-limit': 2 }, phase: 'read', raw: [], pages: 0 }, context);
    if (first.done) throw new Error('Expected checkpoint');
    expect(first.state.phase).toBe('read');
    const second = await readProgram.step(first.state, context);
    if (second.done) throw new Error('Expected formatting');
    expect(second.state.notice).toBe('First');
});
it('rejects impossible calendar dates even when a timezone is supplied', async () => {
    const command = readCapabilities({ start: vi.fn(), resume: vi.fn() }).find(item => item.definition.id === 'im.+chat-messages-list')!;
    await expect(command.preview({ 'chat-id': 'oc_a', start: '2026-02-29T10:00:00Z' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('validates search times with the shared parser while forwarding original values', async () => {
    const command = readCapabilities({ start: vi.fn(), resume: vi.fn() }).find(item => item.definition.id === 'im.+messages-search')!;
    expect(await command.preview({ start: '1767225600', end: '2026-01-31' })).toMatchObject({ request: { body: { filter: { time_range: { start_time: '1767225600', end_time: '2026-01-31' } } } } });
    await expect(command.preview({ start: '2026-02-01', end: '2026-01-31' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});

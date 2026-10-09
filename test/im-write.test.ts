import { expect, it, vi } from 'vitest';
import { writeCapabilities, writePrograms } from '../src/capabilities/im/write';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
function setup() {
    const request = vi.fn(async (_: unknown): Promise<JsonObject> => ({ message_id: 'om_sent', chat_id: 'oc_a', create_time: '1000' }));
    const upload = vi.fn(async (_: unknown): Promise<JsonObject> => ({ image_key: 'img_new' }));
    const context: CommandContext = { lark: { request, ...{ upload } }, selection: { profileId: 'p', identity: 'user', accountId: 'a' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', identities: ['user', 'bot'], accounts: ['a'] }], domains: ['im', 'artifact'], permissions: ['read', 'write'] } };
    const start = vi.fn();
    const artifacts = { stat: vi.fn(async () => ({ id: 'id', owner: 'g', size: 3, state: 'ready' as const, expiresAt: Date.now() + 60000 })), read: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))), upload: vi.fn(), remove: vi.fn() };
    const dependencies = { artifacts, workflows: { start, resume: vi.fn() } };
    const command = (name: string) => writeCapabilities(dependencies).find((item) => item.definition.id === `im.+messages-${name}`)!;
    return { request, upload, context, start, artifacts, dependencies, command };
}
it('normalizes Markdown and mentions while preserving code and reply options', async () => {
    const { request, command, context } = setup();
    await command('reply').execute({ 'message-id': 'om_a', markdown: '# Heading\n## Detail\n```\n# code\n```\n<at id="ou_a">A</at>', 'reply-in-thread': true, 'idempotency-key': 'unique' }, context);
    const sent = (request.mock.calls[0]![0] as { body: JsonObject }).body;
    expect(sent).toMatchObject({ msg_type: 'post', reply_in_thread: true, uuid: 'unique' });
    expect(JSON.parse(String(sent.content)).zh_cn.content[0][0].text).toContain('#### Heading\n\n##### Detail');
    expect(String(sent.content)).toContain('# code');
    expect(String(sent.content)).toContain('user_id');
});
it('supports attachment-only replacement and clear-only edits without accepting mixed sources', async () => {
    const { command, context, request } = setup();
    context.selection.identity = 'bot';
    await command('edit').execute({ 'message-id': 'om_a', 'msg-type': 'post', 'clear-attachments': true }, context);
    expect(JSON.parse(String((request.mock.calls[0]![0] as { body: JsonObject }).body.content))).toEqual({ zh_cn: { content: [] }, files: [] });
    await expect(command('edit').preview({ 'message-id': 'om_a', text: 'Text', 'clear-attachments': true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(command('send').preview({ 'chat-id': 'oc_a', text: 'a', markdown: 'b' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('uploads a grant-owned artifact before sending and exposes no binary in checkpoint state', async () => {
    const { command, context, start, dependencies, artifacts, request, upload } = setup();
    await command('send').execute({ 'chat-id': 'oc_a', image: 'artifact:id/photo.png' }, context);
    let state = start.mock.calls[0]![1] as JsonObject;
    const program = writePrograms(dependencies).find((item) => item.id === start.mock.calls[0]![0])!;
    let result: unknown;
    for (let i = 0; i < 10; i++) { const step = await program.step(state, context); if (step.done) { result = step.output; break; } state = step.state; expect(JSON.stringify(state)).not.toContain('AQID'); }
    expect(artifacts.read).toHaveBeenCalledWith('g', 'id');
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ path: '/open-apis/im/v1/images', fields: { image_type: 'message' } }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((request.mock.calls[0]![0] as { body: JsonObject }).body.content))).toEqual({ image_key: 'img_new' });
    expect(result).toMatchObject({ message_id: 'om_sent' });
});
it('streams large file artifacts without materializing a Blob', async () => {
    const { command, context, start, dependencies, artifacts } = setup();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } });
    const blob = vi.fn(async (): Promise<Blob> => { throw new Error('Must not buffer a large file.'); });
    artifacts.stat.mockResolvedValue({ id: 'id', owner: 'g', size: 80 * 1024 * 1024, state: 'ready', expiresAt: Date.now() + 60000 });
    artifacts.read.mockResolvedValue({ body: stream, blob } as unknown as Response);
    const uploadStream = vi.fn(async (_: unknown) => ({ file_key: 'file_large' }));
    Object.assign(context.lark, { uploadStream });
    await command('send').execute({ 'chat-id': 'oc_a', file: 'artifact:id/archive.zip' }, context);
    let state = start.mock.calls[0]![1] as JsonObject;
    const program = writePrograms(dependencies)[0]!;
    for (let i = 0; i < 5; i++) { const step = await program.step(state, context); if (step.done) break; state = step.state; }
    expect(uploadStream).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ size: 80 * 1024 * 1024, body: stream }) }));
    expect(blob).not.toHaveBeenCalled();
});
it('includes Opus duration from a bounded artifact tail read', async () => {
    const { command, context, start, dependencies, artifacts } = setup();
    const bytes = new Uint8Array(32); bytes.set(new TextEncoder().encode('OggS'), 2); new DataView(bytes.buffer).setBigUint64(8, 48001n, true);
    artifacts.stat.mockResolvedValue({ id: 'id', owner: 'g', size: bytes.length, state: 'ready', expiresAt: Date.now() + 60000 });
    artifacts.read.mockImplementation(async () => new Response(bytes));
    const uploadStream = vi.fn(async (_: unknown) => ({ file_key: 'file_audio' })); Object.assign(context.lark, { uploadStream });
    await command('send').execute({ 'chat-id': 'oc_a', audio: 'artifact:id/audio.ogg' }, context);
    const program = writePrograms(dependencies)[0]!; let state = start.mock.calls[0]![1] as JsonObject;
    for (let i = 0; i < 8; i++) { const step = await program.step(state, context); if (step.done) break; state = step.state; }
    expect(uploadStream).toHaveBeenCalledWith(expect.objectContaining({ fields: { file_type: 'opus', file_name: 'audio.ogg', duration: '2000' } }));
});
it('stages remote files through a bounded credential-free stream before upload', async () => {
    const { context, start, dependencies, artifacts } = setup();
    const remoteFiles = { stream: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } })), read: vi.fn(), put: vi.fn() };
    artifacts.upload.mockResolvedValue({ id: 'id', owner: 'g', size: 3, state: 'ready', expiresAt: Date.now() + 60000 });
    Object.assign(context.lark, { uploadStream: vi.fn(async () => ({ file_key: 'file_remote' })) });
    const injected = { ...dependencies, remoteFiles };
    await writeCapabilities(injected).find((item) => item.definition.id === 'im.+messages-send')!.execute({ 'chat-id': 'oc_a', file: 'https://example.com/report.pdf' }, context);
    let state = start.mock.calls[0]![1] as JsonObject;
    const program = writePrograms(injected)[0]!;
    for (let i = 0; i < 8; i++) { const step = await program.step(state, context); if (step.done) break; state = step.state; }
    expect(remoteFiles.stream).toHaveBeenCalledWith('https://example.com/report.pdf', 100 * 1024 * 1024);
    expect(remoteFiles.read).not.toHaveBeenCalled();
    expect(artifacts.remove).toHaveBeenCalledWith('g', 'id');
});
it('loads message content files from private artifacts before validating and sending', async () => {
    const { command, context, artifacts, request } = setup();
    artifacts.read.mockResolvedValueOnce(new Response('{"text":"Artifact body"}'));
    expect(await command('send').preview({ 'chat-id': 'oc_a', content: '@artifact:id' })).toMatchObject({ deferredArtifactValidation: true });
    expect(artifacts.read).not.toHaveBeenCalled();
    await command('send').execute({ 'chat-id': 'oc_a', content: '@artifact:id' }, context);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ content: '{"text":"Artifact body"}' }) }));
    expect(artifacts.read).toHaveBeenCalledWith('g', 'id');
});

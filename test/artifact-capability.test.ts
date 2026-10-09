import { expect, it, vi } from 'vitest';
import { artifactCapabilities } from '../src/capabilities/artifact/commands';
import type { CommandContext } from '../src/ports/capabilities';

const context: CommandContext = { selection: { profileId: 'p', identity: 'bot' },
    grant: { id: 'grant', revoked: false, expiresAt: Date.now() + 100_000, profiles: [], domains: ['artifact'], permissions: ['read', 'write'] },
    lark: { request: vi.fn() } };
const store = () => ({ upload: vi.fn(async (_owner: string, _size: number, _body: ReadableStream<Uint8Array>) => ({ id: 'artifact-id', owner: 'grant', size: 4, state: 'ready' as const, expiresAt: 1000 })),
    read: vi.fn(async () => new Response(new Uint8Array([0, 1, 254, 255]), { headers: { 'Content-Length': '4' } })), remove: vi.fn(async () => {}) });
it('transfers inline binary content without an upstream Lark request', async () => {
    const artifacts = store();
    const commands = artifactCapabilities(artifacts);
    const upload = commands.find((item) => item.definition.id === 'artifact.upload')!;
    expect(await upload.preview({ content: 'AAH+/w==' })).toMatchObject({ size: 4 });
    expect(artifacts.upload).not.toHaveBeenCalled();
    expect(await upload.execute({ content: 'AAH+/w==' }, context)).toMatchObject({ id: 'artifact-id' });
    expect(artifacts.upload.mock.calls[0]!.slice(0, 2)).toEqual(['grant', 4]);
    const bytes = await new Response(artifacts.upload.mock.calls[0]![2]).arrayBuffer();
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([0, 1, 254, 255]));
    expect(await commands.find((item) => item.definition.id === 'artifact.read')!.execute({ id: 'artifact-id' }, context)).toMatchObject({ content: 'AAH+/w==' });
    expect(artifacts.read).toHaveBeenCalledWith('grant', 'artifact-id');
    expect(context.lark.request).not.toHaveBeenCalled();
});
it('validates Base64 in previews and redirects large reads to authenticated streaming', async () => {
    const artifacts = store();
    const commands = artifactCapabilities(artifacts);
    await expect(commands.find((item) => item.definition.id === 'artifact.upload')!.preview({ content: 'invalid!' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    artifacts.read.mockResolvedValue(new Response('data', { headers: { 'Content-Length': String(1024 * 1024) } }));
    await expect(commands.find((item) => item.definition.id === 'artifact.read')!.execute({ id: 'artifact-id' }, context)).rejects.toMatchObject({ code: 'STREAM_REQUIRED' });
    expect(artifacts.upload).not.toHaveBeenCalled();
});

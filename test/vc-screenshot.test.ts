import { expect, it, vi } from 'vitest';
import { encode } from 'jpeg-js';
import { vcScreenshotCapability } from '../src/capabilities/vc/screenshot';
import type { ArtifactStore } from '../src/ports/artifacts';
import type { CommandContext } from '../src/ports/capabilities';
const context = (download: unknown): CommandContext => ({ lark: { request: vi.fn(), download }, selection: { profileId: 'p', accountId: 'a', identity: 'user' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], domains: ['vc', 'artifact'], permissions: ['read', 'write'] } } as unknown as CommandContext);
it('validates and stores a binary JPEG screenshot with digest under the grant', async () => {
    const bytes = encode({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) }).data;
    const download = vi.fn(async () => new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/jpeg' } }));
    const upload = vi.fn(async (_owner: string, _size: number, _body: ReadableStream<Uint8Array>) => ({ id: 'private-image' }));
    const command = vcScreenshotCapability({ upload } as unknown as ArtifactStore);
    const result = await command.execute({ 'meeting-id': '1234567890123456789', output: 'image.jpg' }, context(download));
    expect(download).toHaveBeenCalledWith({ method: 'POST', path: '/open-apis/vc/v1/bots/screenshot', body: { meeting_id: '1234567890123456789' } });
    expect(result).toMatchObject({ artifact_id: 'private-image', path: 'private-image', size_bytes: bytes.length, content_type: 'image/jpeg', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(upload.mock.calls[0]![0]).toBe('g');
});
it('rejects invalid JPEG and excessive bodies before storing anything', async () => {
    const upload = vi.fn();
    const command = vcScreenshotCapability({ upload } as unknown as ArtifactStore);
    for (const bytes of [new Uint8Array([255, 216, 255, 217]), new Uint8Array(8 * 1024 * 1024 + 1)]) {
        const download = vi.fn(async () => new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/jpeg' } }));
        await expect(command.execute({ 'meeting-id': '1234567890123456789' }, context(download))).rejects.toBeDefined();
    }
    expect(upload).not.toHaveBeenCalled();
});

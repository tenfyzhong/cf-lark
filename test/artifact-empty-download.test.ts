import { expect, it, vi } from 'vitest';
import { saveDownloadResponse } from '../src/capabilities/files/download';
import type { ArtifactStore } from '../src/ports/artifacts';
import type { CommandContext } from '../src/ports/capabilities';
it('saves a declared empty download as an ordinary zero-byte artifact', async () => {
    const upload = vi.fn().mockResolvedValue({ id: 'empty', size: 0 });
    const context = { selection: { profileId: 'p', identity: 'user', accountId: 'a' }, grant: { id: 'g', domains: ['artifact'], permissions: ['write'], profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], expiresAt: Date.now() + 10000 } } as unknown as CommandContext;
    expect(await saveDownloadResponse({ upload } as unknown as ArtifactStore, context, new Response('', { headers: { 'Content-Length': '0' } }), 'empty.md')).toMatchObject({ artifact_id: 'empty', size_bytes: 0 });
    expect(upload).toHaveBeenCalledWith('g', 0, expect.any(ReadableStream));
});
it('accepts a successful bodyless response with explicit zero length', async () => {
    const upload = vi.fn().mockResolvedValue({ id: 'empty', size: 0 });
    const context = { selection: { profileId: 'p', identity: 'user', accountId: 'a' }, grant: { id: 'g', domains: ['artifact'], permissions: ['write'], profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], expiresAt: Date.now() + 10000 } } as unknown as CommandContext;
    await expect(saveDownloadResponse({ upload } as unknown as ArtifactStore, context, new Response(null, { headers: { 'Content-Length': '0' } }), 'empty.md')).resolves.toMatchObject({ size_bytes: 0 });
});

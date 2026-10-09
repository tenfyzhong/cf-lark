import { expect, it, vi } from 'vitest';
import { resolveCalendarDescription } from '../src/capabilities/calendar/description';
import type { ArtifactStore } from '../src/ports/artifacts';
import type { CommandContext } from '../src/ports/capabilities';
it('uploads an owned artifact once and rewrites duplicate image references', async () => {
    const data = new Uint8Array(24); data.set([137,80,78,71,13,10,26,10]); new DataView(data.buffer).setUint32(16, 200); new DataView(data.buffer).setUint32(20, 100);
    const read = vi.fn(async () => new Response(data)), upload = vi.fn(async () => ({ file_token: 'token' }));
    const context = { lark: { upload, brand: 'lark' }, selection: { profileId: 'p', accountId: 'a', identity: 'user' }, grant: { id: 'g', profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], domains: ['artifact'], permissions: ['read'], expiresAt: Date.now()+60000 } } as unknown as CommandContext;
    const result = await resolveCalendarDescription('![One](artifact:img) ![Two](artifact:img)', 'primary', context, { read } as unknown as ArtifactStore);
    expect(result).toContain('internal-api-drive-stream.larksuite.com'); expect(result).toContain('im_w=200&im_h=100&im_size=24'); expect(upload).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledWith('g','img');
});
it('reads Markdown descriptions from a private artifact reference', async () => {
    const read = vi.fn(async () => new Response('# Meeting\n**Agenda**'));
    const context = { lark: {}, selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', profiles: [{ profileId: 'p', accounts: [], identities: ['bot'] }], domains: ['artifact'], permissions: ['read'], expiresAt: Date.now()+60000 } } as unknown as CommandContext;
    expect(await resolveCalendarDescription('@artifact:text-id', 'primary', context, { read } as unknown as ArtifactStore)).toBe('# Meeting\n**Agenda**');
});

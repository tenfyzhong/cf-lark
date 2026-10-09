import { expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import type { CommandContext } from '../src/ports/capabilities';
import type { ArtifactStore } from '../src/ports/artifacts';
const args = { 'base-token': 'b', 'table-id': 't', 'view-id': 'v', json: '@file1' };
function fixture(domains = ['base', 'artifact']) {
    const request = vi.fn().mockResolvedValue({});
    const read = vi.fn().mockResolvedValue(new Response('{"filter":[]}'));
    const context = { lark: { request }, selection: { profileId: 'p', accountId: 'a', identity: 'user' }, grant: { id: 'grant', domains, permissions: ['read', 'write'], profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], expiresAt: Date.now() + 100000 } } as unknown as CommandContext;
    const capability = baseCapabilities({ artifacts: { read } as unknown as ArtifactStore }).find(c => c.definition.id === 'base.+view-set-filter')!;
    return { request, read, context, capability };
}
it('resolves owned JSON artifacts before the upstream request', async () => {
    const f = fixture();
    await f.capability.execute(args, f.context);
    expect(f.read).toHaveBeenCalledWith('grant', 'file1');
    expect(f.request.mock.calls[0]![0].body).toEqual({ filter: [] });
});
it('does not read artifacts in preview or without artifact authorization', async () => {
    const f = fixture(['base']);
    expect(await f.capability.preview(args)).toMatchObject({ deferredArtifactValidation: true });
    await expect(f.capability.execute(args, f.context)).rejects.toBeDefined();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
});
it('rejects invalid artifact JSON before upstream writes', async () => {
    const f = fixture(); f.read.mockResolvedValue(new Response('not JSON'));
    await expect(f.capability.execute(args, f.context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(f.request).not.toHaveBeenCalled();
});
it('preserves numeric lexemes in DSL artifacts', async () => {
    const f = fixture(); const dsl = '{"measures":[],"value":9007199254740993}'; f.read.mockResolvedValue(new Response(dsl));
    const capability = baseCapabilities({ artifacts: { read: f.read } as unknown as ArtifactStore }).find(c => c.definition.id === 'base.+data-query')!;
    await capability.execute({ 'base-token': 'b', dsl: '@file1' }, f.context);
    expect(f.request.mock.calls[0]![0]).toMatchObject({ rawBody: dsl });
});

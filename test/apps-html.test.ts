import { expect, it, vi } from 'vitest';
import { appsPrograms } from '../src/capabilities/apps/programs';
const selection = { profileId: 'p', accountId: 'a', identity: 'user' }, grant = { id: 'g', revoked: false, expiresAt: Date.now() + 10000, profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], domains: ['apps', 'artifact'], permissions: ['read', 'write'] };
function fixture(appType = 'HTML') {
    let packed: Blob | undefined;
    const artifacts = { stat: vi.fn().mockResolvedValue({ size: 13 }), read: vi.fn().mockImplementation(async (_owner, id) => new Response(id === 'packed' ? packed : '<html></html>')), upload: vi.fn().mockImplementation(async (_owner, size, stream) => { packed = await new Response(stream).blob(); return { id: 'packed', size }; }), remove: vi.fn() };
    const request = vi.fn().mockResolvedValueOnce({ app: { app_type: appType } }).mockResolvedValueOnce({ kvs: [{ key: 'upload_url', value: 'https://upload.test/a' }, { key: 'tos_path', value: '/bundle' }] }).mockResolvedValueOnce({ release_id: 'r', secret: 'omit' });
    const remoteFiles = { put: vi.fn().mockResolvedValue({}) };
    return { artifacts, request, remoteFiles, context: { selection, grant, lark: { request } } as any, p: appsPrograms({ artifacts, remoteFiles } as any).find((p) => p.id === 'apps-html-publish')! };
}
it('packages single index.html then checkpoints upload and release', async () => {
    const f = fixture(); let result: any = { state: { args: { 'app-id': 'app_a', path: 'source', name: 'index.html' }, phase: 'prepare' } };
    for (let i = 0; i < 5 && !result.done; i++) result = await f.p.step(result.state, f.context);
    expect(result).toEqual({ done: true, output: { release_id: 'r' } });
    expect(f.remoteFiles.put).toHaveBeenCalledOnce();
    expect(f.request.mock.calls[2]![0]).toEqual({ method: 'POST', path: '/open-apis/spark/v1/apps/app_a/releases', body: { tos_path: '/bundle' } });
    expect(f.artifacts.remove).toHaveBeenCalledWith('g', 'packed');
});
it('rejects non-HTML app type before upload preparation', async () => {
    const f = fixture('FRONTEND'); await expect(f.p.step({ args: { 'app-id': 'app_a', path: 'source', name: 'index.html' }, phase: 'prepare' }, f.context)).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    expect(f.remoteFiles.put).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledOnce();
});
it('rejects archives without an entrypoint or with credential entries', async () => {
    const { validateHtmlArchive, packHtml } = await import('../src/capabilities/apps/html');
    const packed = await packHtml(new Blob(['html']));
    expect(await validateHtmlArchive(packed.stream(), false)).toEqual({ files: 1, rawBytes: 4 });
    const tar = new Uint8Array(await new Response(packed.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    tar.fill(0, 0, 100); tar.set(new TextEncoder().encode('.env'));
    tar.fill(32, 148, 156); const sum = tar.slice(0, 512).reduce((a, b) => a + b, 0); tar.set(new TextEncoder().encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
    const gzip = new Blob([tar]).stream().pipeThrough(new CompressionStream('gzip'));
    await expect(validateHtmlArchive(gzip, false)).rejects.toMatchObject({ code: 'SENSITIVE_FILES' });
});

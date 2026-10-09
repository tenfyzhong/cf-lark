import { expect, it, vi } from 'vitest';
import { appsPrograms } from '../src/capabilities/apps/programs';
import { appsCapabilities } from '../src/capabilities/apps/commands';
import type { CommandContext } from '../src/ports/capabilities';
import type { ArtifactFiles } from '../src/ports/artifacts';
import type { RemoteFiles } from '../src/ports/remote-files';
const selection = { profileId: 'p', accountId: 'a', identity: 'user' as const };
const grant = { id: 'g', revoked: false, expiresAt: Date.now() + 600000, profiles: [{ profileId: 'p', identities: ['user'], accounts: ['a'] }], domains: ['apps', 'artifact'], permissions: ['read', 'write'] } as CommandContext['grant'];
function fixture(responses: Record<string, unknown>[]) {
    const blob = new Blob(['data']);
    const artifacts = { stat: vi.fn().mockResolvedValue({ size: 4 }), read: vi.fn().mockResolvedValue(new Response(blob)), upload: vi.fn().mockResolvedValue({ id: 'out', size: 4 }), remove: vi.fn() } as unknown as ArtifactFiles;
    const remote = { put: vi.fn().mockResolvedValue({ etag: 'etag' }), stream: vi.fn().mockResolvedValue(new Response(blob, { headers: { 'content-length': '4' } })), read: vi.fn() } as unknown as RemoteFiles;
    const request = vi.fn(); responses.forEach((value) => request.mockResolvedValueOnce(value));
    const context = { selection, grant, lark: { request, download: vi.fn().mockResolvedValue(new Response(blob, { headers: { 'content-length': '4' } })) } } as unknown as CommandContext;
    return { artifacts, remote, request, context, programs: appsPrograms({ artifacts, remoteFiles: remote }) };
}
it('checkpoints pre-upload, presigned PUT and callback with exact ETag', async () => {
    const f = fixture([{ upload_url: 'https://storage.test/upload', upload_id: 'u' }, { file_name: 'a.txt', path: '/a', size_bytes: 4 }]);
    const program = f.programs.find((program) => program.id === 'apps-file-upload')!;
    let state: Record<string, unknown> = { phase: 'prepare', args: { 'app-id': 'app_a', file: 'input', name: 'a.txt' } };
    for (let step = 0; step < 3; step++) {
        const result = await program.step(state, f.context);
        if (step < 2) { expect(result.done).toBe(false); if (!result.done) state = result.state; }
        else expect(result).toEqual({ done: true, output: { file_name: 'a.txt', path: '/a', size_bytes: 4 } });
    }
    expect(f.request.mock.calls[0]![0].body).toEqual({ file_name: 'a.txt', file_size: 4, content_type: 'text/plain; charset=utf-8' });
    expect(f.request.mock.calls[1]![0].body).toEqual({ upload_id: 'u', etag: 'etag' });
    expect(f.remote.put).toHaveBeenCalledOnce();
    expect(f.artifacts.read).toHaveBeenCalledWith('g', 'input');
});
it('downloads signed files into grant-owned artifacts', async () => {
    const f = fixture([{ signed_url: 'https://storage.test/file' }]);
    const program = f.programs.find((program) => program.id === 'apps-file-download')!;
    const first = await program.step({ phase: 'prepare', args: { 'app-id': 'app_a', path: '/a' } }, f.context);
    expect(first.done).toBe(false); if (first.done) throw new Error('Missing checkpoint.');
    expect(await program.step(first.state, f.context)).toEqual({ done: true, output: { path: '/a', output: 'out', artifactId: 'out', size_bytes: 4 } });
    expect(f.artifacts.upload).toHaveBeenCalledWith('g', 4, expect.any(ReadableStream));
});
it('exports a source archive with POST body and validates source XOR before IO', async () => {
    const f = fixture([]), program = f.programs.find((program) => program.id === 'apps-export')!;
    expect(await program.step({ phase: 'prepare', args: { 'meta-token': 'token' } }, f.context)).toMatchObject({ done: true, output: { artifactId: 'out', size_bytes: 4 } });
    expect((f.context.lark as any).download).toHaveBeenCalledWith({ method: 'POST', path: '/open-apis/spark/v1/apps/export', body: { meta_token: 'token' } });
    const capability = appsCapabilities().find((item) => item.definition.id === 'apps.+export')!;
    await expect(capability.preview({ 'app-id': 'app_a', 'meta-token': 't' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('checks artifact permission and upload size before preparing an upstream mutation', async () => {
    const f = fixture([]), program = f.programs.find((program) => program.id === 'apps-file-upload')!;
    await expect(program.step({ phase: 'prepare', args: { 'app-id': 'app_a', file: 'input' } }, { ...f.context, grant: { ...grant, domains: ['apps'] } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    vi.mocked(f.artifacts.stat).mockResolvedValue({ size: 100 * 1024 * 1024 + 1 } as any);
    await expect(program.step({ phase: 'prepare', args: { 'app-id': 'app_a', file: 'input' } }, f.context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(f.request).not.toHaveBeenCalled();
});

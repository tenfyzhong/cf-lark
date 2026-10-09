import { describe, it, expect, vi } from 'vitest';
import { driveDownloadCapabilities } from '../src/capabilities/drive/downloads';
import { ServiceError } from '../src/domain/errors';
import type { JsonObject } from '../src/domain/models';
import type { CommandContext } from '../src/ports/capabilities';
import type { ApiRequest, DownloadRequest } from '../src/ports/lark';
import type { ArtifactStore } from '../src/ports/artifacts';
function setup(responses: (JsonObject | Error)[] = []) {
    const uploaded: string[] = [];
    const artifacts: ArtifactStore = { upload: vi.fn(async (owner: string, size: number, body: ReadableStream<Uint8Array>) => { uploaded.push(await new Response(body).text()); return { id: 'artifact', size, owner, state: 'ready' as const, expiresAt: Date.now() + 60000 }; }), read: vi.fn(), remove: vi.fn() };
    const context = { selection: { profileId: 'p', accountId: 'u', identity: 'user' as const }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', accounts: ['u'], identities: ['user' as const] }], domains: ['drive', 'artifact'], permissions: ['read', 'write'] as ('read' | 'write')[] }, lark: { request: vi.fn(async (_: ApiRequest) => { const result = responses.shift() ?? {}; if (result instanceof Error) throw result; return result; }), download: vi.fn(async (_: DownloadRequest) => new Response('bytes', { headers: { 'Content-Length': '5', 'Content-Type': 'image/png' } })) } };
    const command = (action: string) => driveDownloadCapabilities(artifacts).find((item) => item.definition.id === `drive.+${action}`)!;
    return { context, uploaded, command };
}
describe('Drive binary downloads and previews', () => {
    it('previews complete transfer requests without downloading', async () => {
        const f = setup();
        expect(await f.command('version-get').preview({ 'file-token': 'file', version: '123' })).toMatchObject({ requests: [{ method: 'GET', path: '/open-apis/drive/v1/files/file/download', query: { version: '123' } }] });
        expect(await f.command('cover').preview({ 'file-token': 'file', spec: 'square', output: 'cover' })).toMatchObject({ requests: [{ method: 'GET', path: '/open-apis/drive/v1/medias/file/preview_download', query: { preview_type: '1', width: 360, height: 360, policy: 'near' } }] });
        expect(f.context.lark.download).not.toHaveBeenCalled();
    });
    it('lists seven cover presets without any network request', async () => {
        const f = setup(); const output = await f.command('cover').execute({ 'file-token': 'file', 'list-only': true }, f.context) as JsonObject;
        expect(output.candidates).toHaveLength(7); expect(f.context.lark.request).not.toHaveBeenCalled(); expect(f.context.lark.download).not.toHaveBeenCalled();
    });
    it('validates conflicting preview modes before network requests', async () => {
        const f = setup();
        for (const args of [{ 'file-token': 'file' }, { 'file-token': 'file', 'list-only': true, type: 'pdf' }, { 'file-token': 'file', type: 'pdf' }, { 'file-token': 'file', type: 'pdf', output: 'a', 'if-exists': 'bad' }]) await expect(f.command('preview').preview(args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('resolves Wiki fallback, selects a ready image alias and inherits the server version', async () => {
        const f = setup([new ServiceError('UPSTREAM_ERROR', 'lookup failed'), { node: { obj_token: 'file', obj_type: 'file' } }, { version: '1234567890123456789', preview_results: [{ preview_type: 1, preview_status: 1 }, { preview_type: 7, preview_status: 0 }] }]);
        expect(await f.command('preview').execute({ 'wiki-token': 'wiki', type: 'image', output: 'picture' }, f.context)).toMatchObject({ artifact_id: 'artifact', selected_type: 'jpg', wiki_token: 'wiki' });
        expect(f.context.lark.download).toHaveBeenCalledWith({ path: '/open-apis/drive/v1/medias/file/preview_download', query: { preview_type: '7', version: '1234567890123456789' } }); expect(f.uploaded).toEqual(['bytes']);
    });
    it('does not reinterpret successful online-document lookup as a file', async () => {
        const f = setup([{ obj_token: 'doc', obj_type: 'docx' }]); await expect(f.command('download').execute({ 'file-token': 'file', output: 'name' }, f.context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' }); expect(f.context.lark.download).not.toHaveBeenCalled();
    });
    it('enforces permission denial before downloading and tolerates only scope failures', async () => {
        const denied = setup([{ obj_token: 'file', obj_type: 'file' }, { auth_result: false }]); await expect(denied.command('download').execute({ 'file-token': 'file', output: 'name' }, denied.context)).rejects.toMatchObject({ code: 'FORBIDDEN' }); expect(denied.context.lark.download).not.toHaveBeenCalled();
        const optional = setup([{ obj_token: 'file', obj_type: 'file' }, new ServiceError('UPSTREAM_ERROR', 'scope unavailable', 403, { upstreamCode: 99991676 })]); expect(await optional.command('download').execute({ 'file-token': 'file', output: 'name' }, optional.context)).toMatchObject({ artifact_id: 'artifact', filename: 'name.png' });
    });
    it('bypasses discovery for source_file but not the source alias', async () => {
        const f = setup([{ obj_token: 'file', obj_type: 'file' }]); await f.command('preview').execute({ 'file-token': 'file', type: 'source_file', output: 'source' }, f.context); expect(f.context.lark.request).toHaveBeenCalledTimes(1); expect(f.context.lark.download.mock.calls[0]![0].query).toEqual({ preview_type: '16' });
    });
    it('preserves historical version strings and export download routes', async () => {
        const f = setup(); await f.command('version-get').execute({ 'file-token': 'file', version: '1234567890123456789' }, f.context); await f.command('export-download').execute({ 'file-token': 'exported', 'file-name': 'report.pdf' }, f.context);
        expect(f.context.lark.download.mock.calls.map(([request]) => request)).toEqual([{ path: '/open-apis/drive/v1/files/file/download', query: { version: '1234567890123456789' } }, { path: '/open-apis/drive/v1/export_tasks/file/exported/download' }]);
    });
});

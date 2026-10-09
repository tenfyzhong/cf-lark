import { describe, it, expect, vi } from 'vitest';
import { driveConversionCapabilities, driveConversionPrograms } from '../src/capabilities/drive/conversions';
import type { JsonObject } from '../src/domain/models';
import type { ArtifactFiles } from '../src/ports/artifacts';
import type { ApiRequest, DownloadRequest, UploadRequest } from '../src/ports/lark';
function setup(responses: JsonObject[] = []) {
    const blob = new Blob(['# Source']);
    const artifacts: ArtifactFiles = { stat: vi.fn(async (owner: string, id: string) => ({ id, owner, size: blob.size, state: 'ready' as const, expiresAt: Date.now() + 60000 })), read: vi.fn(async () => new Response(blob)), upload: vi.fn(async (owner: string, size: number, _body: ReadableStream<Uint8Array>) => ({ id: 'out', owner, size, state: 'ready' as const, expiresAt: Date.now() + 60000 })), remove: vi.fn() };
    const lark = { request: vi.fn(async (_: ApiRequest) => responses.shift() ?? {}), upload: vi.fn(async (_: UploadRequest) => ({ file_token: 'media' })), download: vi.fn(async (_: DownloadRequest) => new Response('export', { headers: { 'Content-Length': '6' } })) };
    const context = { lark, selection: { profileId: 'p', accountId: 'u', identity: 'user' as const }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', accounts: ['u'], identities: ['user' as const] }], domains: ['drive', 'artifact'], permissions: ['read', 'write'] as ('read' | 'write')[] } };
    const run = async (action: string, args: JsonObject) => { let state: JsonObject = { phase: 'start', args }; const program = driveConversionPrograms(artifacts).find((item) => item.id === `drive-${action}`)!; for (let i = 0; i < 100; i++) { const result = await program.step(state, context); if (result.done) return result.output; state = result.state; } throw new Error('Workflow did not complete'); };
    return { artifacts, context, lark, run };
}
describe('Drive import and export workflows', () => {
    it('previews Markdown export using document fetch rather than an export task', async () => {
        const capability = driveConversionCapabilities({ start: vi.fn(), resume: vi.fn() }).find((item) => item.definition.id === 'drive.+export')!;
        expect(await capability.preview({ token: 'doc', 'doc-type': 'docx', 'file-extension': 'markdown' })).toMatchObject({ request: { path: '/open-apis/docs_ai/v1/documents/doc/fetch', body: { format: 'markdown' } } });
    });
    it('resolves Wiki, validates format, checkpoints export ticket and downloads the result', async () => {
        const f = setup([{ node: { obj_token: 'doc', obj_type: 'docx' } }, { ticket: 'ticket' }, { result: { job_status: 2 } }, { result: { job_status: 0, file_token: 'exported', file_name: 'Report' } }]);
        expect(await f.run('export', { url: 'https://example.test/wiki/wiki', 'file-extension': 'pdf' })).toMatchObject({ artifact_id: 'out', filename: 'Report.pdf', wiki_token: 'wiki', ticket: 'ticket' });
        expect(f.lark.request.mock.calls.filter(([req]) => req.path === '/open-apis/drive/v1/export_tasks')).toEqual([[{ method: 'POST', path: '/open-apis/drive/v1/export_tasks', body: { token: 'doc', type: 'docx', file_extension: 'pdf' } }]]);
    });
    it('exports markdown directly and resolves a metadata title', async () => {
        const f = setup([{ document: { content: '# Export' } }, { metas: [{ title: 'Notes' }] }]);
        expect(await f.run('export', { token: 'doc', 'doc-type': 'docx', 'file-extension': 'markdown' })).toMatchObject({ filename: 'Notes.md', size_bytes: 8 });
        expect(f.lark.download).not.toHaveBeenCalled();
    });
    it('imports Markdown through media staging and preserves implicit root mounting', async () => {
        const f = setup([{ ticket: 'ticket' }, { result: { job_status: 0, token: 'doc', type: 'docx' } }]);
        expect(await f.run('import', { file: 'artifact', 'file-name': 'source.md', type: 'docx' })).toMatchObject({ token: 'doc', ready: true });
        expect(f.lark.upload.mock.calls[0]![0].fields).toMatchObject({ parent_type: 'ccm_import_open', file_name: 'source.md', extra: '{"obj_type":"docx","file_extension":"md"}' });
        expect(f.lark.upload.mock.calls[0]![0].fields).not.toHaveProperty('parent_node');
        expect(f.lark.request.mock.calls[0]![0].body).toEqual({ file_extension: 'md', file_token: 'media', type: 'docx', file_name: 'source', point: { mount_type: 1, mount_key: '' } });
    });
    it('rejects Wiki mount folders before uploads and invalid combinations in preview', async () => {
        const f = setup([{ node: { node_token: 'wiki' } }]); await expect(f.run('import', { file: 'artifact', 'file-name': 'file.md', type: 'docx', 'folder-token': 'wiki' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' }); expect(f.lark.upload).not.toHaveBeenCalled();
        const caps = driveConversionCapabilities({ start: vi.fn(), resume: vi.fn() });
        for (const [action, args] of [['import', { file: 'a', 'file-name': 'a.pptx', type: 'docx' }], ['import', { file: 'a', 'file-name': 'a.md', type: 'docx', 'target-token': 'base' }], ['export', { token: 'doc', 'doc-type': 'sheet', 'file-extension': 'csv' }], ['export', { token: 'doc', 'doc-type': 'docx', 'file-extension': 'pdf', 'only-schema': true }]] as [string, JsonObject][]) await expect(caps.find((cap) => cap.definition.id === `drive.+${action}`)!.preview(args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

import { expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import { basePrograms } from '../src/capabilities/base/programs';
import type { ArtifactFiles } from '../src/ports/artifacts';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
const args = { 'base-token': 'b', 'table-id': 't', 'record-id': 'r', 'field-id': 'Attachments' };
function fixture() {
    const request = vi.fn().mockResolvedValue({}); const upload = vi.fn().mockResolvedValue({ file_token: 'token' });
    const download = vi.fn().mockResolvedValue(new Response('bytes', { headers: { 'Content-Length': '5', 'Content-Type': 'text/plain' } }));
    const files = { stat: vi.fn().mockResolvedValue({ id: 'f', size: 5 }), read: vi.fn().mockImplementation(() => Promise.resolve(new Response('bytes'))), upload: vi.fn().mockResolvedValue({ id: 'saved', size: 5 }) } as unknown as ArtifactFiles;
    const context = { lark: { request, upload, download }, selection: { profileId: 'p', accountId: 'a', identity: 'user' }, grant: { id: 'g', domains: ['base', 'artifact'], permissions: ['read', 'write'], profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], expiresAt: Date.now() + 100000 } } as unknown as CommandContext;
    return { files, context, request, upload, download };
}
async function run(name: string, a: JsonObject, f: ReturnType<typeof fixture>) {
    const program = basePrograms(f.files).find(p => p.id === `base-${name}`)!;
    let state: JsonObject = { args: a, phase: 'start' };
    for (let i = 0; i < 60; i++) { const step = await program.step(state, f.context); if (step.done) return step.output; state = step.state; }
    throw new Error('Not completed');
}
it('resolves field names before removing selected tokens', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce({ id: 'fld1', type: 'attachment' }).mockResolvedValueOnce({ removed: true });
    expect(await run('record-remove-attachment', { ...args, 'file-token': ['f1', 'f2'] }, f)).toEqual({ removed: true });
    expect(f.request.mock.calls[1]![0]).toEqual({ method: 'POST', path: '/open-apis/base/v3/bases/b/tables/t/remove_attachments', body: { attachments: { r: { fld1: [{ file_token: 'f1' }, { file_token: 'f2' }] } } } });
});
it('preflights every source before uploading and appends only after completed uploads', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce({ field_id: 'fld1', type: 'attachment' }).mockResolvedValueOnce({ appended: true });
    expect(await run('record-upload-attachment', { ...args, file: ['f'], artifactNames: { f: 'report.txt' } }, f)).toEqual({ appended: true });
    expect(f.upload.mock.calls[0]![0].fields).toMatchObject({ parent_type: 'bitable_file', parent_node: 'b', file_name: 'report.txt' });
    expect(f.request.mock.calls[1]![0].body).toEqual({ attachments: { r: { fld1: [{ file_token: 'token' }] } } });
});
it('deduplicates form source uploads and replaces attachment field values', async () => {
    const f = fixture();
    await run('form-submit', { 'share-token': 'shr', 'base-token': 'b', json: { fields: { A: 'old', Rating: 5 }, attachments: { A: ['f'], B: ['f'] } }, artifactNames: { f: 'report.txt' } }, f);
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.upload.mock.calls[0]![0].fields).toMatchObject({ parent_type: 'bitable_tmp_point', extra: '{"share_token":"shr"}' });
    const attachment = { file_token: 'token', name: 'report.txt', mime_type: 'text/plain', size: 5 };
    expect(f.request.mock.calls[0]![0].body).toEqual({ share_token: 'shr', content: { A: [attachment], B: [attachment], Rating: 5 } });
});
it('rejects inaccessible later artifacts before any upstream writes', async () => {
    const f = fixture(); vi.mocked(f.files.stat).mockResolvedValueOnce({ id: 'f', size: 5 } as never).mockRejectedValueOnce(new Error('Missing'));
    await expect(run('record-upload-attachment', { ...args, file: ['f', 'missing'] }, f)).rejects.toThrow('Missing');
    expect(f.upload).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
});
it('preserves Base download extra and requested ordering', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce({ attachments: { r: { fld1: [{ file_token: 'f1', name: 'one.txt', size: 5, extra_info: 'route1' }, { file_token: 'f2', name: 'two.txt', size: 5, extra_info: 'route2' }] } } });
    const result = await run('record-download-attachment', { ...args, 'file-token': ['f2', 'f1'], output: 'downloads/' }, f) as {downloaded: JsonObject[]};
    expect(f.download.mock.calls[0]![0]).toEqual({ path: '/open-apis/drive/v1/medias/f2/download', query: { extra: 'route2' } });
    expect(result.downloaded.map(d => d.file_token)).toEqual(['f2', 'f1']);
    expect(result.downloaded[0]).toMatchObject({ artifact_id: 'saved', filename: 'two.txt' });
});
it.each([
    ['record-upload-attachment', { ...args, file: ['f'], name: 'forbidden' }],
    ['record-remove-attachment', { ...args, 'file-token': ['f', 'f'] }],
    ['form-submit', { 'share-token': 's', json: { attachments: { A: [] } } }],
])('validates %s before workflow startup', async (name, a) => {
    await expect(baseCapabilities().find(c => c.definition.id === `base.+${name}`)!.preview(a)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});

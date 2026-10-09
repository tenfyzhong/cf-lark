import { expect, it, vi } from 'vitest';
import { mediaUploadProgram } from '../src/capabilities/files/index';
import { uploadPrograms } from '../src/capabilities/files/upload-programs';
import type { ArtifactFiles } from '../src/ports/artifacts';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
import type { UploadRequest } from '../src/ports/lark';

function setup(size = 4, identity: 'user' | 'bot' = 'user') {
    const files: ArtifactFiles = { stat: vi.fn(async () => ({ id: 'artifact', owner: 'grant', size, expiresAt: Date.now() + 100_000, state: 'ready' as const })),
        upload: vi.fn(), remove: vi.fn(), read: vi.fn(async (_owner, _id, range) => new Response(new Uint8Array(range?.length ?? size))) };
    const request = vi.fn(async (_input: unknown): Promise<JsonObject> => ({ metas: [{ url: 'https://example.test/file' }] }));
    const upload = vi.fn(async (_input: UploadRequest): Promise<JsonObject> => ({ file_token: 'file-result', data_version: '2' }));
    const context: CommandContext = { lark: { request, upload, download: vi.fn() } as unknown as CommandContext['lark'],
        selection: { profileId: 'p', ...(identity === 'user' ? { accountId: 'ou_owner' } : {}), identity },
        grant: { id: 'grant', expiresAt: Date.now() + 100_000, revoked: false, profiles: [{ profileId: 'p', accounts: ['ou_owner'], identities: ['user', 'bot'] }],
            domains: ['drive', 'docs', 'artifact'], permissions: ['read', 'write'] } };
    return { files, request, upload, context, programs: uploadPrograms(files) };
}
it('uploads a Drive file and retains creation success through metadata and permission follow-ups', async () => {
    const { programs, files, upload, request, context } = setup(4, 'bot');
    const program = programs.find((item) => item.id === 'drive-upload')!;
    let state: JsonObject = { phase: 'start', args: { file: 'artifact', name: 'report.txt', 'wiki-token': 'wiki-node' } };
    let result;
    for (let i = 0; i < 8; i++) {
        result = await program.step(state, context);
        if (result.done) break;
        state = result.state;
    }
    expect(result).toMatchObject({ done: true, output: { file_token: 'file-result', file_name: 'report.txt', size: 4, version: '2', url: 'https://example.test/file', permission_grant: { status: 'granted' } } });
    expect(files.read).toHaveBeenCalledWith('grant', 'artifact');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]![0]).toMatchObject({ path: '/open-apis/drive/v1/files/upload_all', fields: { parent_type: 'wiki', parent_node: 'wiki-node', file_name: 'report.txt', size: '4' } });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: '/open-apis/drive/v1/permissions/file-result/members', body: { member_type: 'openid', member_id: 'ou_owner', perm: 'full_access', type: 'user' } }));
});
it('uses bounded exact artifact ranges for multipart uploads and finalizes once', async () => {
    const size = 21 * 1024 * 1024;
    const { programs, files, upload, request, context } = setup(size);
    request.mockResolvedValueOnce({ upload_id: 'upload', block_size: 8 * 1024 * 1024, block_num: 3 })
        .mockResolvedValueOnce({ file_token: 'completed' }).mockResolvedValue({ metas: [] });
    const program = programs.find((item) => item.id === 'drive-upload')!;
    let state: JsonObject = { phase: 'start', args: { file: 'artifact', name: 'large.bin', 'file-token': 'existing' } };
    let result;
    for (let i = 0; i < 12; i++) { result = await program.step(state, context); if (result.done) break; state = result.state; }
    expect(result).toMatchObject({ done: true, output: { file_token: 'completed', size } });
    expect(upload.mock.calls.map(([input]) => input.fields.seq)).toEqual(['0', '1', '2']);
    expect(files.read).toHaveBeenNthCalledWith(3, 'grant', 'artifact', { offset: 16 * 1024 * 1024, length: 5 * 1024 * 1024 });
    expect(request.mock.calls.filter(([input]) => (input as { path: string }).path.endsWith('upload_finish'))).toHaveLength(1);
    expect(request.mock.calls[0]![0]).toMatchObject({ body: { file_token: 'existing', size } });
});
it('uploads document media with routing metadata', async () => {
    const { programs, upload, context } = setup();
    const program = programs.find((item) => item.id === 'docs-media-upload')!;
    let state: JsonObject = { phase: 'start', args: { file: 'artifact', name: 'image.png', 'parent-type': 'docx_image', 'parent-node': 'block', 'doc-id': 'doc' } };
    let result;
    for (let i = 0; i < 5; i++) { result = await program.step(state, context); if (result.done) break; state = result.state; }
    expect(result).toMatchObject({ done: true, output: { file_token: 'file-result' } });
    expect(upload.mock.calls[0]![0]).toMatchObject({ path: '/open-apis/drive/v1/medias/upload_all', fields: { extra: '{"drive_route_token":"doc"}', parent_type: 'docx_image', parent_node: 'block' } });
});
it('rejects invalid multipart dimensions and conflicting targets before file reads', async () => {
    const { programs, files, request, context } = setup(21 * 1024 * 1024);
    const program = programs.find((item) => item.id === 'drive-upload')!;
    await expect(program.step({ phase: 'start', args: { file: 'artifact', 'folder-token': 'a', 'wiki-token': 'b' } }, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    request.mockResolvedValue({ upload_id: 'upload', block_size: 100 * 1024 * 1024, block_num: 1 });
    let state: JsonObject = { phase: 'start', args: { file: 'artifact' } };
    const first = await program.step(state, context);
    if (!first.done) state = first.state;
    await expect(program.step(state, context)).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
    expect(files.read).not.toHaveBeenCalled();
});

it('uploads Base media with caller routing metadata and domain ownership', async () => {
    const { files, upload, context } = setup();
    const program = mediaUploadProgram(files, { id: 'base-media-upload', domain: 'base' });
    expect(program).toMatchObject({ id: 'base-media-upload', domain: 'base' });
    let state: JsonObject = { phase: 'start', args: { file: 'artifact', name: 'image.png', 'parent-type': 'bitable_form', 'parent-node': 'base-token', extra: { share_token: 'share' } } };
    for (let i = 0; i < 5; i++) { const result = await program.step(state, context); if (result.done) break; state = result.state; }
    expect(upload.mock.calls[0]![0].fields.extra).toBe('{"share_token":"share"}');
    await expect(program.step({ phase: 'start', args: { ...(state.args as JsonObject), extra: [] } }, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});

it('omits the empty import parent node only for single-part media uploads', async () => {
    const { files, context, upload } = setup();
    const program = mediaUploadProgram(files);
    const first = await program.step({ phase: 'start', args: { file: 'artifact', 'parent-type': 'ccm_import_open', 'parent-node': '', extra: { obj_type: 'sheet', file_extension: 'xlsx' } } }, context);
    if (first.done) throw new Error('Expected upload preparation');
    await program.step(first.state, context);
    expect(upload.mock.calls[0]![0].fields).not.toHaveProperty('parent_node');
    const large = setup(21 * 1024 * 1024);
    large.request.mockResolvedValue({ upload_id: 'up', block_size: 8 * 1024 * 1024, block_num: 3 });
    const multipart = mediaUploadProgram(large.files);
    const start = await multipart.step({ phase: 'start', args: { file: 'artifact', 'parent-type': 'ccm_import_open', 'parent-node': '' } }, large.context);
    if (start.done) throw new Error('Expected preparation');
    await multipart.step(start.state, large.context);
    expect(large.request.mock.calls[0]![0]).toMatchObject({ body: { parent_node: '' } });
});

it.each([
    ['fake_office_exampleW', 'office_docx_file'],
    ['local_office_exampleW', 'office_docx_file'],
    ['aaaaObbbbFccccLdddd0eeeeXW', 'office_docx_file'],
    ['fake_office_exampleS', 'docx_file'],
    ['ordinaryW', 'docx_file'],
])('preserves Office token routing for %s in single and multipart requests', async (node, expected) => {
    for (const size of [0, 21 * 1024 * 1024]) {
        const f = setup(size); const program = f.programs.find(item => item.id === 'docs-media-upload')!;
        f.request.mockResolvedValue({ upload_id: 'parts', block_size: 8 * 1024 * 1024, block_num: 3 });
        const first = await program.step({ phase: 'start', args: { file: 'artifact', name: 'report.docx', 'parent-type': 'docx_file', 'parent-node': node, 'doc-id': 'document' } }, f.context);
        if (first.done) throw new Error('Expected upload preparation'); await program.step(first.state, f.context);
        const fields = size ? (f.request.mock.calls[0]![0] as { body: JsonObject }).body : f.upload.mock.calls[0]![0].fields;
        expect(fields).toMatchObject({ parent_type: expected, parent_node: node, extra: '{"drive_route_token":"document"}' });
    }
});
it.each(['overwrite', 'ambiguous', 'unavailable', 'permission-error'])('does not grant an arbitrary account or lose successful bytes: %s', async mode => {
    const f = setup(0, 'bot'); const program = f.programs.find(item => item.id === 'drive-upload')!;
    if (mode === 'ambiguous') f.context.grant.profiles[0]!.accounts = ['one', 'two'];
    if (mode === 'unavailable') f.context.grant.profiles[0]!.accounts = [];
    if (mode === 'permission-error') f.request.mockRejectedValue(new Error('Follow-up unavailable'));
    let state: JsonObject = { phase: 'start', args: { file: 'artifact', name: 'empty.txt', ...(mode === 'overwrite' ? { 'file-token': 'existing' } : {}) } };
    let output: JsonObject | undefined;
    for (let i = 0; i < 10; i++) { const result = await program.step(state, f.context); if (result.done) { output = result.output as JsonObject; break; } state = result.state; }
    expect(output).toMatchObject({ file_token: 'file-result', size: 0 }); expect(f.upload).toHaveBeenCalledOnce();
    if (mode === 'overwrite') expect(output).not.toHaveProperty('permission_grant');
    else expect(output).toMatchObject({ permission_grant: { status: mode === 'permission-error' ? 'failed' : 'skipped' } });
    if (mode !== 'permission-error') expect(f.request.mock.calls.filter(([input]) => String((input as JsonObject).path).includes('/permissions/'))).toHaveLength(0);
});
it('rejects an unauthorized permission recipient before reading artifact bytes', async () => {
    const f = setup(1, 'bot'); f.context.selection.accountId = 'outsider';
    await expect(f.programs[0]!.step({ phase: 'start', args: { file: 'artifact' } }, f.context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.files.read).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
});

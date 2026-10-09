import { describe, it, expect, vi } from 'vitest';
import { markdownCapabilities, markdownPrograms } from '../src/capabilities/markdown/commands';
import type { ArtifactFiles } from '../src/ports/artifacts';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
import type { ApiRequest, DownloadRequest, UploadRequest } from '../src/ports/lark';
function setup(downloads: string[] = [], responses: JsonObject[] = []) {
    const data = new Map<string, Blob>();
    const artifacts: ArtifactFiles = {
        async upload(owner, size, body) { const blob = await new Response(body).blob(); expect(blob.size).toBe(size); const id = `artifact${data.size}`; data.set(id, blob); return { id, owner, size, state: 'ready', expiresAt: Date.now() + 60000 }; },
        async read(_owner, id, range) { const blob = data.get(id)!; return new Response(range ? blob.slice(range.offset, range.offset + range.length) : blob); },
        async stat(owner, id) { return { id, owner, size: data.get(id)!.size, state: 'ready', expiresAt: Date.now() + 60000 }; }, async remove(_owner, id) { data.delete(id); },
    };
    const lark = { request: vi.fn(async (_: ApiRequest) => responses.shift() ?? {}), download: vi.fn(async (_: DownloadRequest) => new Response(downloads.shift() ?? '', { headers: { 'Content-Disposition': 'attachment; filename="notes.md"' } })), upload: vi.fn(async (_: UploadRequest) => ({ file_token: 'new', version: '2' })) };
    const context = { lark, selection: { profileId: 'p', accountId: 'ou_user', identity: 'user' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', accounts: ['ou_user'], identities: ['user'] }], domains: ['markdown', 'artifact'], permissions: ['read', 'write'] } } satisfies CommandContext;
    async function run(action: string, args: JsonObject) {
        const program = markdownPrograms(artifacts).find((item) => item.id === `markdown-${action}`)!;
        let state: JsonObject = { phase: 'start', args };
        for (let i = 0; i < 100; i++) { const result = await program.step(state, context); if (result.done) return result.output; state = result.state; }
        throw new Error('Workflow did not complete');
    }
    return { artifacts, data, context, lark, run };
}
describe('Markdown shortcuts', () => {
    it('streams large fetch results instead of buffering or rejecting above 32 MiB', async () => {
        const fixture = setup(); let sent = 0; const total = 33 * 1024 * 1024;
        fixture.lark.download.mockImplementationOnce(async () => new Response(new ReadableStream<Uint8Array>({ pull(controller) { if (sent === total) controller.close(); else { const chunk = new Uint8Array(1024 * 1024).fill(97); sent += chunk.byteLength; controller.enqueue(chunk); } } }), { headers: { 'Content-Length': String(total) } }));
        expect(await fixture.run('fetch', { 'file-token': 'file' })).toMatchObject({ artifact_id: 'artifact0', size_bytes: total });
    });
    it('fetches native source preview type16 and preserves the server filename', async () => {
        const fixture = setup(['# Notes']);
        expect(await fixture.run('fetch', { 'file-token': 'file' })).toMatchObject({ content: '# Notes', file_name: 'notes.md', size_bytes: 7 });
        expect(fixture.lark.download).toHaveBeenCalledExactlyOnceWith({ path: '/open-apis/drive/v1/medias/file/preview_download', query: { preview_type: '16' } });
    });
    it('does not upload no-match patches and preserves names for matches', async () => {
        const noMatch = setup(['text']);
        expect(await noMatch.run('patch', { 'file-token': 'file', pattern: 'missing', content: '' })).toMatchObject({ updated: false, match_count: 0 });
        expect(noMatch.lark.upload).not.toHaveBeenCalled();
        const fixture = setup(['old old'], [{ metas: [{ title: 'original.md' }] }, {}]);
        expect(await fixture.run('patch', { 'file-token': 'file', pattern: 'old', content: 'new' })).toMatchObject({ updated: true, match_count: 2, version: '2', size_bytes_after: 7 });
        const upload = fixture.lark.upload.mock.calls[0]![0];
        expect(upload.fields).toMatchObject({ file_name: 'original.md', file_token: 'file' });
        expect(await upload.file.body.text()).toBe('new new');
    });
    it('creates and overwrites inline Markdown through artifact-backed upload', async () => {
        const fixture = setup([], [{}]);
        expect(await fixture.run('create', { name: 'notes.md', content: 'hello', 'wiki-token': 'https://example.test/wiki/parent' })).toMatchObject({ file_token: 'new', file_name: 'notes.md', size_bytes: 5 });
        expect(fixture.lark.upload.mock.calls[0]![0].fields).toMatchObject({ parent_type: 'wiki', parent_node: 'parent' });
    });
    it('compares remote versions as strings and produces line changes', async () => {
        const fixture = setup(['old\n', 'new\n']);
        expect(await fixture.run('diff', { 'file-token': 'file', 'from-version': '1234567890123456789', 'context-lines': 0 })).toMatchObject({ changed: true, added_lines: 1, deleted_lines: 1, from_version: '1234567890123456789' });
        expect(fixture.lark.download.mock.calls.map(([request]) => request.query)).toEqual([{ preview_type: '16', version: '1234567890123456789' }, { preview_type: '16' }]);
    });
    it('rejects ambiguous content, invalid regex and version combinations in preview', async () => {
        const capabilities = markdownCapabilities({ start: vi.fn(), resume: vi.fn() });
        for (const [action, args] of [
            ['create', { content: '', name: 'notes.md' }], ['overwrite', { 'file-token': 'file', content: 'x', file: 'artifact' }],
            ['patch', { 'file-token': 'file', pattern: '(a)\\1', content: 'x', regex: true }], ['diff', { 'file-token': 'file', 'to-version': '2' }],
        ] as [string, JsonObject][]) await expect(capabilities.find((item) => item.definition.id === `markdown.+${action}`)!.preview(args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

import { describe, it, expect, vi } from 'vitest';
import { driveDirectoryPrograms } from '../src/capabilities/drive/directories';
import type { JsonObject } from '../src/domain/models';
import type { ArtifactFiles } from '../src/ports/artifacts';
import type { ApiRequest, DownloadRequest, UploadRequest } from '../src/ports/lark';
function setup(entries: JsonObject[], responses: (JsonObject | Error)[] = []) {
    const data = new Map<string, Blob>([['manifest', new Blob([JSON.stringify({ version: 1, entries })])], ['local', new Blob(['same'])]]);
    const artifacts: ArtifactFiles = { stat: vi.fn(async (owner: string, id: string) => ({ id, owner, size: data.get(id)!.size, state: 'ready' as const, expiresAt: Date.now() + 60000 })), read: vi.fn(async (_owner, id, range) => { const blob = data.get(id)!; return new Response(range ? blob.slice(range.offset, range.offset + range.length) : blob); }), upload: vi.fn(async (owner: string, size: number, body: ReadableStream<Uint8Array>) => { const id = `result${data.size}`; data.set(id, await new Response(body).blob()); return { id, owner, size, state: 'ready' as const, expiresAt: Date.now() + 60000 }; }), remove: vi.fn() };
    const lark = { request: vi.fn(async (_: ApiRequest) => { const value = responses.shift() ?? {}; if (value instanceof Error) throw value; return value; }), download: vi.fn(async (_: DownloadRequest) => new Response('same', { headers: { 'Content-Length': '4' } })), upload: vi.fn(async (_: UploadRequest) => ({ file_token: 'uploaded' })) };
    const hasher = { sha256: vi.fn(async (body: ReadableStream<Uint8Array>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await new Response(body).arrayBuffer()))].map((v) => v.toString(16).padStart(2, '0')).join('')) };
    const context = { lark, selection: { profileId: 'p', accountId: 'u', identity: 'user' as const }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', identities: ['user' as const], accounts: ['u'] }], domains: ['drive', 'artifact'], permissions: ['read', 'write'] as ('read' | 'write')[] } };
    async function run(action: string, args: JsonObject = {}) { let state: JsonObject = { phase: 'start', args: { 'local-dir': 'manifest', 'folder-token': 'root', ...args } }; const program = driveDirectoryPrograms(artifacts, hasher).find((item) => item.id === `drive-${action}`)!; for (let i = 0; i < 200; i++) { const result = await program.step(state, context); if (result.done) return result.output as JsonObject; state = result.state; } throw new Error('Workflow did not complete'); }
    return { artifacts, data, lark, hasher, context, run };
}
describe('Drive directory manifest workflows', () => {
    it('compares quick timestamps at remote precision and preserves online document paths', async () => {
        const f = setup([{ path: 'same.txt', type: 'file', artifact_id: 'local', modified_time: '1700000000123' }, { path: 'new.txt', type: 'file', artifact_id: 'local' }], [{ files: [{ token: 'same', name: 'same.txt', type: 'file', modified_time: '1700000000' }, { token: 'remote', name: 'remote.txt', type: 'file' }, { token: 'doc', name: 'Document', type: 'docx' }] }]);
        expect(await f.run('status', { quick: true })).toMatchObject({ detection: 'quick', unchanged: [{ rel_path: 'same.txt', file_token: 'same' }], new_local: [{ rel_path: 'new.txt' }], new_remote: [{ rel_path: 'remote.txt', file_token: 'remote' }] }); expect(f.lark.download).not.toHaveBeenCalled();
    });
    it('hashes exact comparisons as streams and lists every recursive page', async () => {
        const f = setup([{ path: 'dir/same.txt', type: 'file', artifact_id: 'local' }], [{ files: [{ token: 'folder', name: 'dir', type: 'folder' }], has_more: true, page_token: 'next' }, { files: [] }, { files: [{ token: 'same', name: 'same.txt', type: 'file' }] }]);
        expect(await f.run('status')).toMatchObject({ unchanged: [{ rel_path: 'dir/same.txt', file_token: 'same' }] }); expect(f.hasher.sha256).toHaveBeenCalledTimes(2); expect(f.lark.request.mock.calls[1]![0].query).toMatchObject({ page_token: 'next' });
    });
    it('rejects unsafe paths and duplicate remote paths before mutations', async () => {
        await expect(setup([{ path: '../escape', type: 'file', artifact_id: 'local' }]).run('push')).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        const f = setup([], [{ files: [{ token: 'a', name: 'dup', type: 'file' }, { token: 'b', name: 'dup', type: 'file' }] }]); await expect(f.run('push')).rejects.toMatchObject({ code: 'DUPLICATE_REMOTE_PATH' }); expect(f.lark.upload).not.toHaveBeenCalled();
    });
    it('creates empty directories and uploads nested files once', async () => {
        const f = setup([{ path: 'empty', type: 'directory' }, { path: 'nested/new.txt', type: 'file', artifact_id: 'local' }], [{ files: [] }, { token: 'empty-folder' }, { token: 'nested-folder' }, {}]);
        expect(await f.run('push')).toMatchObject({ summary: { uploaded: 1, failed: 0 } }); expect(f.lark.upload).toHaveBeenCalledTimes(1); expect(f.lark.upload.mock.calls[0]![0].fields).toMatchObject({ parent_node: 'nested-folder', file_name: 'new.txt' });
    });
    it('pulls into a new manifest and protects local files shadowed by online documents', async () => {
        const f = setup([{ path: 'Document', type: 'file', artifact_id: 'local' }, { path: 'orphan', type: 'file', artifact_id: 'local' }], [{ files: [{ token: 'doc', name: 'Document', type: 'docx' }, { token: 'binary', name: 'download.txt', type: 'file', modified_time: '1700000000' }] }]);
        const output = await f.run('pull', { 'delete-local': true, yes: true }); expect(output).toMatchObject({ summary: { downloaded: 1, deleted_local: 1 } });
        const manifest = JSON.parse(await f.data.get(String(output.manifest_artifact_id))!.text()); expect(manifest.entries.map((entry: JsonObject) => entry.path).sort()).toEqual(['Document', 'download.txt']); expect(f.artifacts.remove).not.toHaveBeenCalled();
    });
    it('suppresses remote deletion after an upload failure and reports the partial snapshot', async () => {
        const f = setup([{ path: 'new', type: 'file', artifact_id: 'local' }], [{ files: [{ token: 'orphan', name: 'orphan', type: 'file' }] }]);
        f.lark.upload.mockRejectedValueOnce(new Error('transfer failed'));
        expect(await f.run('push', { 'delete-remote': true, yes: true })).toMatchObject({ partial_failure: true, summary: { failed: 1, deleted_remote: 0 } });
        expect(f.lark.request.mock.calls.some(([request]) => request.method === 'DELETE')).toBe(false);
    });
    it('selects newest duplicate files and gives renamed duplicates stable suffixes', async () => {
        const remote = { files: [{ token: 'old', name: 'same.txt', type: 'file', modified_time: '1700000000', created_time: '1600000000' }, { token: 'new', name: 'same.txt', type: 'file', modified_time: '1700000001', created_time: '1600000001' }] };
        const newest = setup([], [remote]); await newest.run('pull', { 'on-duplicate-remote': 'newest' });
        expect(newest.lark.download.mock.calls[0]![0].path).toContain('/new/download');
        const rename = setup([], [remote]); const output = await rename.run('pull', { 'on-duplicate-remote': 'rename' });
        const manifest = JSON.parse(await rename.data.get(String(output.manifest_artifact_id))!.text());
        expect(manifest.entries.map((entry: JsonObject) => entry.path)).toEqual(['same.txt', expect.stringMatching(/^same__lark_[a-f0-9]{12}\.txt$/)]);
    });
    it.each(['local-wins', 'remote-wins', 'keep-both'])('resolves modified files using %s', async (policy) => {
        const f = setup([{ path: 'file.txt', type: 'file', artifact_id: 'local', modified_time: '1700000001' }], [{ files: [{ token: 'remote', name: 'file.txt', type: 'file', modified_time: '1700000000' }] }, {}]);
        const output = await f.run('sync', { quick: true, 'on-conflict': policy });
        expect(output.summary).toMatchObject({ failed: 0, pushed: policy === 'local-wins' ? 1 : 0, pulled: policy === 'local-wins' ? 0 : 1 });
        const manifest = JSON.parse(await f.data.get(String(output.manifest_artifact_id))!.text());
        expect(manifest.entries).toHaveLength(policy === 'keep-both' ? 2 : 1);
    });
    it('rejects deletion without yes before remote I/O', async () => {
        const f = setup([]); await expect(f.run('push', { 'delete-remote': true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' }); expect(f.lark.request).not.toHaveBeenCalled();
    });
    it('returns unresolved ask conflicts before any transfer mutation', async () => {
        const f = setup([{ path: 'file', type: 'file', artifact_id: 'local', modified_time: '1700000001' }], [{ files: [{ token: 'remote', name: 'file', type: 'file', modified_time: '1700000000' }] }]);
        expect(await f.run('sync', { quick: true, 'on-conflict': 'ask' })).toMatchObject({ requires_decisions: true, conflicts: ['file'] }); expect(f.lark.upload).not.toHaveBeenCalled(); expect(f.lark.download).not.toHaveBeenCalled();
    });
});

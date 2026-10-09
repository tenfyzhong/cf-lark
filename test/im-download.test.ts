import { expect, it, vi } from 'vitest';
import { resourceCapability } from '../src/capabilities/im/resources';
import type { CommandContext } from '../src/ports/capabilities';
it('downloads message bytes to a grant-owned artifact with a suggested filename', async () => {
    const upload = vi.fn(async (_owner: string, _size: number, stream: ReadableStream<Uint8Array>) => { expect([...new Uint8Array(await new Response(stream).arrayBuffer())]).toEqual([1, 2, 3]); return { id: 'artifact', owner: 'g', size: 3, expiresAt: 5000, state: 'ready' as const }; });
    const artifacts = { upload, read: vi.fn(), remove: vi.fn(), stat: vi.fn() };
    const download = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3', 'content-disposition': 'attachment; filename="photo.png"' } }));
    const context: CommandContext = { lark: { request: vi.fn(), ...{ download } }, selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }], domains: ['im', 'artifact'], permissions: ['read', 'write'] } };
    const command = resourceCapability(artifacts);
    expect(await command.execute({ 'message-id': 'om_a', 'file-key': 'img_a', type: 'image' }, context)).toMatchObject({ artifact_id: 'artifact', size_bytes: 3, saved_path: 'photo.png' });
    expect(upload).toHaveBeenCalledWith('g', 3, expect.any(ReadableStream));
    await expect(command.preview({ 'message-id': 'om_a', 'file-key': '../x', type: 'file' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('streams downloads without a length into bounded artifact ingestion', async () => {
    const ingest = vi.fn(async () => ({ id: 'unknown', owner: 'g', size: 3, state: 'ready' as const, expiresAt: 5000 }));
    const artifacts = { ingest, upload: vi.fn(), read: vi.fn(), remove: vi.fn(), stat: vi.fn() };
    const context: CommandContext = { lark: { request: vi.fn(), ...{ download: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) } }, selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }], domains: ['im', 'artifact'], permissions: ['read', 'write'] } };
    expect(await resourceCapability(artifacts).execute({ 'message-id': 'om_a', 'file-key': 'file_a', type: 'file' }, context)).toMatchObject({ artifact_id: 'unknown', size_bytes: 3 });
    expect(ingest).toHaveBeenCalledWith('g', 2_000_000_000, expect.any(ReadableStream));
});
it('preserves an explicit basename and infers its extension from an encoded disposition name', async () => {
    const artifacts = { upload: vi.fn(async () => ({ id: 'id', owner: 'g', size: 1, state: 'ready' as const, expiresAt: 1 })), read: vi.fn(), remove: vi.fn(), stat: vi.fn() };
    const context: CommandContext = { lark: { request: vi.fn(), ...{ download: vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'content-length': '1', 'content-disposition': "attachment; filename*=UTF-8''original%20report.docx" } })) } }, selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }], domains: ['im', 'artifact'], permissions: ['read', 'write'] } };
    expect(await resourceCapability(artifacts).execute({ 'message-id': 'om_a', 'file-key': 'file_a', type: 'file', output: 'report' }, context)).toMatchObject({ saved_path: 'report.docx' });
});

it.each([['image/webp', '.webp'], ['application/vnd.ms-excel', '.xls'], ['audio/mpeg', '.mp3'], ['application/x-rar-compressed', '.rar']])('infers resource extensions for %s', async (mime, extension) => {
    const artifacts = { upload: vi.fn(async () => ({ id: 'id', owner: 'g', size: 1, state: 'ready' as const, expiresAt: 1 })), read: vi.fn(), remove: vi.fn(), stat: vi.fn() };
    const context: CommandContext = { lark: { request: vi.fn(), ...{ download: vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'content-length': '1', 'content-type': mime } })) } }, selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }], domains: ['im', 'artifact'], permissions: ['read', 'write'] } };
    expect(await resourceCapability(artifacts).execute({ 'message-id': 'om_a', 'file-key': 'file_a', type: 'file' }, context)).toMatchObject({ saved_path: `file_a${extension}` });
});

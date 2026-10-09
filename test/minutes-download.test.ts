import { expect, it, vi } from 'vitest';
import { minutesDownloadCapability, minutesDownloadProgram } from '../src/capabilities/minutes/download';
import type { ArtifactStore } from '../src/ports/artifacts';
import type { RemoteFiles } from '../src/ports/remote-files';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
it('downloads each presigned media URL through the unauthenticated port and saves grant artifacts', async () => {
    const request = vi.fn(async () => ({ download_url: 'https://cdn.example.test/media.mp4?signature=private' }));
    const stream = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Length': '3', 'Content-Type': 'video/mp4', 'Content-Disposition': 'attachment; filename="../recording.mp4"' } }));
    const upload = vi.fn(async (_owner: string, _size: number, _body: ReadableStream<Uint8Array>) => ({ id: 'a', size: 3, expiresAt: 9999 }));
    const program = minutesDownloadProgram({ upload } as unknown as ArtifactStore, { stream } as unknown as RemoteFiles);
    const context: CommandContext = { lark: { request }, selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', accounts: [], identities: ['bot'] }], domains: ['minutes', 'artifact'], permissions: ['read', 'write'] } };
    let state: JsonObject = { args: { 'minute-tokens': 'token' }, index: 0, phase: 'url', results: [] };
    for (let i = 0; i < 4; i++) {
        const result = await program.step(state, context);
        if (result.done) { expect(result.output).toMatchObject({ minute_token: 'token', saved_path: 'a', size_bytes: 3, name: 'recording.mp4' }); break; }
        state = result.state;
    }
    expect(request).toHaveBeenCalledTimes(1); expect(stream).toHaveBeenCalledWith('https://cdn.example.test/media.mp4?signature=private', 2_000_000_000);
    expect(upload.mock.calls[0]!.slice(0, 2)).toEqual(['g', 3]);
});
it('validates mutually exclusive output names without starting a workflow', async () => {
    const start = vi.fn();
    await expect(minutesDownloadCapability({ start, resume: vi.fn() }).preview({ 'minute-tokens': 'token', output: 'a', 'output-dir': 'b' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(start).not.toHaveBeenCalled();
});
it('uses reserved streaming ingestion when the remote server omits Content-Length', async () => {
    const ingest = vi.fn(async (_owner: string, _limit: number, _stream: ReadableStream<Uint8Array>) => ({ id: 'chunked', size: 3, expiresAt: 9999 }));
    const stream = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } }));
    const context = { lark: { request: vi.fn() }, selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }], domains: ['minutes', 'artifact'], permissions: ['read', 'write'] } } as CommandContext;
    const result = await minutesDownloadProgram({ ingest } as unknown as ArtifactStore, { stream } as unknown as RemoteFiles).step({ args: { 'minute-tokens': 'token' }, index: 0, phase: 'download', url: 'https://example.test/a', results: [] }, context);
    expect(result).toMatchObject({ done: false, state: { results: [{ saved_path: 'chunked', size_bytes: 3 }] } });
    expect(ingest.mock.calls[0]!.slice(0, 2)).toEqual(['g', 2_000_000_000]);
});

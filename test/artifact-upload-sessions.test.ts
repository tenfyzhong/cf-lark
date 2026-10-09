import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { ArtifactUploadService } from '../src/application/artifact-uploads';
import { SqliteArtifactUploads } from '../src/infrastructure/storage/artifact-uploads';
import { SqliteArtifactLedger } from '../src/infrastructure/storage/artifact-ledger';
const partSize = 64 * 1024 * 1024;
function setup(maxBytes = 2_000_000_000) {
    const db = new DatabaseSync(':memory:'); const sql = { exec(query: string, ...values: (string | number | null)[]) { return db.prepare(query).all(...values) as Record<string, unknown>[]; } };
    let now = 100000;
    const ledger = new SqliteArtifactLedger(sql, { maxBytes, maxClassA: 100, maxClassB: 100 }, () => now);
    const uploads = new SqliteArtifactUploads(sql);
    const bucket = { put: vi.fn(), get: vi.fn(), delete: vi.fn(), createMultipart: vi.fn().mockResolvedValue('upstream'), uploadPart: vi.fn().mockImplementation(async (_id, _upload, number, body) => { await new Response(body).arrayBuffer(); return { partNumber: number, etag: `etag${number}` }; }), completeMultipart: vi.fn(), abortMultipart: vi.fn(), headSize: vi.fn().mockResolvedValue(undefined) };
    return { service: new ArtifactUploadService(ledger, bucket, uploads, () => now, 60), bucket, ledger, uploads, advance: (n: number) => { now += n; } };
}
const body = (size: number) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(size)); controller.close(); } });
it('reserves full size and completes only after exact ordered parts', async () => {
    const f = setup(); const session = await f.service.beginUpload('owner', partSize + 3);
    expect(session).toMatchObject({ size: partSize + 3, partSize, partCount: 2, status: 'uploading' });
    expect((await f.ledger.usage()).bytes).toBe(partSize + 3);
    await expect(f.service.completeUpload('owner', session.id)).rejects.toMatchObject({ code: 'INCOMPLETE_UPLOAD' });
    await expect(f.service.uploadPart('owner', session.id, 2, 3, body(3))).rejects.toMatchObject({ code: 'INVALID_PART' });
    await f.service.uploadPart('owner', session.id, 1, partSize, body(partSize));
    await f.service.uploadPart('owner', session.id, 2, 3, body(3));
    expect(await f.service.completeUpload('owner', session.id)).toMatchObject({ id: session.id, state: 'ready', size: partSize + 3 });
    expect(f.bucket.completeMultipart).toHaveBeenCalledExactlyOnceWith(session.id, 'upstream', [{ partNumber: 1, etag: 'etag1' }, { partNumber: 2, etag: 'etag2' }]);
    expect(await f.ledger.get(session.id)).toMatchObject({ state: 'ready' });
});
it('rejects wrong owner, expiry, declared size and short streams before accepting parts', async () => {
    const f = setup(); const session = await f.service.beginUpload('owner', 4);
    await expect(f.service.getUpload('other', session.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.service.uploadPart('owner', session.id, 1, 3, body(3))).rejects.toMatchObject({ code: 'INVALID_PART' });
    expect(f.bucket.uploadPart).not.toHaveBeenCalled();
    await expect(f.service.uploadPart('owner', session.id, 1, 4, body(3))).rejects.toMatchObject({ code: 'UPLOAD_UNCERTAIN' });
    expect((await f.service.getUpload('owner', session.id)).status).toBe('writing-part');
    await expect(f.service.uploadPart('owner', session.id, 1, 4, body(4))).rejects.toMatchObject({ code: 'UPLOAD_BUSY' });
    f.advance(60000);
    await expect(f.service.getUpload('owner', session.id)).rejects.toMatchObject({ status: 404 });
});
it('does not repeat accepted parts or uncertain completion', async () => {
    const f = setup(); const session = await f.service.beginUpload('owner', 4);
    await f.service.uploadPart('owner', session.id, 1, 4, body(4));
    await f.service.uploadPart('owner', session.id, 1, 4, body(4));
    expect(f.bucket.uploadPart).toHaveBeenCalledTimes(1);
    f.bucket.completeMultipart.mockRejectedValueOnce(new Error('Lost response'));
    await expect(f.service.completeUpload('owner', session.id)).rejects.toMatchObject({ code: 'UPLOAD_UNCERTAIN' });
    await expect(f.service.completeUpload('owner', session.id)).rejects.toMatchObject({ code: 'UPLOAD_UNCERTAIN' });
    f.bucket.headSize.mockResolvedValueOnce(4);
    expect(await f.service.completeUpload('owner', session.id)).toMatchObject({ state: 'ready' });
    expect(f.bucket.completeMultipart).toHaveBeenCalledTimes(1);
});
it('keeps quota reserved after failed start or failed abort and cleans known expired sessions', async () => {
    const f = setup(8); f.bucket.createMultipart.mockRejectedValueOnce(new Error('Unknown creation'));
    await expect(f.service.beginUpload('owner', 4)).rejects.toMatchObject({ code: 'UPLOAD_UNCERTAIN' });
    expect((await f.ledger.usage()).bytes).toBe(4);
    const session = await f.service.beginUpload('owner', 4);
    f.bucket.abortMultipart.mockRejectedValueOnce(new Error('Cannot abort'));
    await expect(f.service.abortUpload('owner', session.id)).rejects.toThrow();
    expect((await f.ledger.usage()).bytes).toBe(8);
    await f.service.abortUpload('owner', session.id);
    expect((await f.ledger.usage()).bytes).toBe(4);
});
it('claims part writes atomically before external IO', async () => {
    const f = setup(); const session = await f.service.beginUpload('owner', 4);
    let finish!: () => void;
    f.bucket.uploadPart.mockImplementationOnce(async () => { await new Promise<void>(resolve => { finish = resolve; }); return { partNumber: 1, etag: 'one' }; });
    const pending = f.service.uploadPart('owner', session.id, 1, 4, body(4));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await expect(f.service.uploadPart('owner', session.id, 1, 4, body(4))).rejects.toMatchObject({ code: 'UPLOAD_BUSY' });
    finish(); await pending;
    expect(f.bucket.uploadPart).toHaveBeenCalledTimes(1);
});
it('expires known sessions through shared artifact cleanup and prunes their metadata', async () => {
    const { ArtifactService } = await import('../src/application/artifacts');
    const f = setup(); const session = await f.service.beginUpload('owner', 4);
    f.advance(60000);
    await new ArtifactService(f.ledger, f.bucket).cleanup();
    await f.service.cleanup();
    expect(f.bucket.abortMultipart).toHaveBeenCalledWith(session.id, 'upstream');
    expect((await f.ledger.usage()).bytes).toBe(0);
    expect(await f.uploads.get(session.id)).toBeUndefined();
});

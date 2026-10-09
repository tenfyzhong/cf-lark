import { expect, it, vi } from 'vitest';
import { PrivateR2Bucket } from '../src/infrastructure/storage/r2-bucket';

it('streams unknown bodies into bounded multipart parts and aborts overflow', async () => {
    const parts: Uint8Array[] = [];
    const upload = { uploadId: 'upload', key: 'artifact', uploadPart: vi.fn(async (number: number, body: ReadableStream<Uint8Array>) => {
        parts.push(new Uint8Array(await new Response(body).arrayBuffer())); return { partNumber: number, etag: String(number) };
    }), complete: vi.fn(async () => ({})), abort: vi.fn(async () => {}) };
    const bucket = { createMultipartUpload: vi.fn(async () => upload) } as unknown as R2Bucket;
    const store = new PrivateR2Bucket(bucket, 4); const consume = vi.fn(async () => {});
    expect(await store.putUnknown('artifact', new Response('abcdefghij').body!, 12, consume)).toBe(10);
    expect(parts.map((part) => new TextDecoder().decode(part))).toEqual(['abcd', 'efgh', 'ij']);
    expect(consume).toHaveBeenCalledTimes(5);
    expect(upload.complete).toHaveBeenCalledWith([{ partNumber: 1, etag: '1' }, { partNumber: 2, etag: '2' }, { partNumber: 3, etag: '3' }]);
    await expect(store.putUnknown('overflow', new Response('oversized').body!, 3, consume)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(upload.abort).toHaveBeenCalledTimes(1);
});
it('stores an empty stream with one empty put and no multipart upload', async () => {
    const bucket = { put: vi.fn(), createMultipartUpload: vi.fn() } as unknown as R2Bucket;
    const consume = vi.fn();
    expect(await new PrivateR2Bucket(bucket).putUnknown('empty', new Response('').body!, 10, consume)).toBe(0);
    expect(bucket.createMultipartUpload).not.toHaveBeenCalled();
    expect(bucket.put).toHaveBeenCalledExactlyOnceWith('empty', expect.any(Uint8Array), { httpMetadata: { contentType: 'application/octet-stream' } });
    expect(consume).toHaveBeenCalledTimes(1);
});

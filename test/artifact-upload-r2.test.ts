import { expect, it, vi } from 'vitest';
import { PrivateR2Bucket } from '../src/infrastructure/storage/r2-bucket';
it('uses private R2 multipart handles and exact streamed parts', async () => {
    const handle = { uploadId: 'remote', uploadPart: vi.fn().mockImplementation(async (number, stream) => { expect(await new Response(stream).text()).toBe('data'); return { partNumber: number, etag: 'etag' }; }), complete: vi.fn(), abort: vi.fn() };
    const bucket = { createMultipartUpload: vi.fn().mockResolvedValue(handle), resumeMultipartUpload: vi.fn().mockReturnValue(handle), head: vi.fn().mockResolvedValue({ size: 4 }) } as unknown as R2Bucket;
    const adapter = new PrivateR2Bucket(bucket);
    expect(await adapter.createMultipart('id')).toBe('remote');
    expect(await adapter.uploadPart('id', 'remote', 1, new Response('data').body!, 4)).toEqual({ partNumber: 1, etag: 'etag' });
    await adapter.completeMultipart('id', 'remote', [{ partNumber: 1, etag: 'etag' }]);
    expect(handle.complete).toHaveBeenCalledWith([{ partNumber: 1, etag: 'etag' }]);
    expect(await adapter.headSize('id')).toBe(4);
    await expect(adapter.abortMultipart('id', 'unknown:id')).rejects.toMatchObject({ code: 'UPLOAD_UNCERTAIN' });
    expect(handle.abort).not.toHaveBeenCalled();
});

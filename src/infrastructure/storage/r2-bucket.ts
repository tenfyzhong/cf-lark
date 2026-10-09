import { ServiceError } from '../../domain/errors';
import type { ArtifactBucket, ArtifactRange, ArtifactPart } from '../../ports/artifacts';

export class PrivateR2Bucket implements ArtifactBucket {
    constructor(private readonly bucket: R2Bucket, private readonly partSize = 64 * 1024 * 1024) {}
    async put(id: string, body: ReadableStream<Uint8Array>, size: number) {
        const stream = new FixedLengthStream(size);
        await Promise.all([
            body.pipeTo(stream.writable),
            this.bucket.put(id, stream.readable, { httpMetadata: { contentType: 'application/octet-stream' } }),
        ]);
    }
    async putUnknown(id: string, body: ReadableStream<Uint8Array>, maximum: number, consume: () => Promise<void>, onUpload?: (uploadId: string) => Promise<void>): Promise<number> {
        const reader = body.getReader();
        let first = await reader.read();
        while (!first.done && !first.value.byteLength) first = await reader.read();
        if (first.done) { await consume(); await this.bucket.put(id, new Uint8Array(), { httpMetadata: { contentType: 'application/octet-stream' } }); return 0; }
        await consume();
        const upload = await this.bucket.createMultipartUpload(id, { httpMetadata: { contentType: 'application/octet-stream' } });
        const parts: R2UploadedPart[] = [];
        let chunks: Uint8Array[] = []; let buffered = 0; let total = 0;
        const flush = async () => {
            if (!buffered) return;
            await consume();
            const values = chunks; let index = 0;
            const stream = new ReadableStream<Uint8Array>({ pull(controller) {
                if (index < values.length) controller.enqueue(values[index++]!); else controller.close();
            } });
            if (typeof FixedLengthStream !== 'undefined') {
                const fixed = new FixedLengthStream(buffered);
                const [part] = await Promise.all([upload.uploadPart(parts.length + 1, fixed.readable), stream.pipeTo(fixed.writable)]);
                parts.push(part);
            } else parts.push(await upload.uploadPart(parts.length + 1, stream));
            chunks = []; buffered = 0;
        };
        try {
            await onUpload?.(upload.uploadId);
            while (true) {
                const next = first; if (next.done) break;
                total += next.value.byteLength;
                if (total > maximum) throw new ServiceError('FILE_TOO_LARGE', 'The download exceeded its reserved maximum.', 413);
                let offset = 0;
                while (offset < next.value.byteLength) {
                    const count = Math.min(this.partSize - buffered, next.value.byteLength - offset);
                    chunks.push(next.value.subarray(offset, offset + count)); offset += count; buffered += count;
                    if (buffered === this.partSize) await flush();
                }
                first = await reader.read();
            }
            await flush(); await consume(); await upload.complete(parts);
            return total;
        } catch (error) {
            void reader.cancel().catch(() => {});
            try { await upload.abort(); } catch { /* The reservation remains until cleanup if abort cannot be confirmed. */ }
            throw error;
        }
    }
    async createMultipart(id: string) {
        return (await this.bucket.createMultipartUpload(id, { httpMetadata: { contentType: 'application/octet-stream' } })).uploadId;
    }
    async uploadPart(id: string, uploadId: string, partNumber: number, body: ReadableStream<Uint8Array>, size: number): Promise<ArtifactPart> {
        const upload = this.bucket.resumeMultipartUpload(id, uploadId);
        if (typeof FixedLengthStream === 'undefined') return upload.uploadPart(partNumber, body);
        const fixed = new FixedLengthStream(size);
        const [receipt] = await Promise.all([upload.uploadPart(partNumber, fixed.readable), body.pipeTo(fixed.writable)]);
        return receipt;
    }
    async completeMultipart(id: string, uploadId: string, parts: ArtifactPart[]) {
        await this.bucket.resumeMultipartUpload(id, uploadId).complete(parts);
    }
    async headSize(id: string) { return (await this.bucket.head(id))?.size; }
    async abortMultipart(id: string, uploadId: string) {
        if (uploadId.startsWith('unknown:')) throw new ServiceError('UPLOAD_UNCERTAIN', 'An unknown multipart creation cannot be confirmed aborted.', 409);
        try { await this.bucket.resumeMultipartUpload(id, uploadId).abort(); }
        catch (error) {
            if (!(error instanceof Error) || !/(?:NoSuchUpload|10024|multipart upload does not exist)/iu.test(error.message)) throw error;
        }
    }
    async get(id: string, range?: ArtifactRange) {
        const object = await this.bucket.get(id, range ? { range } : undefined);
        if (!object) return null;
        return new Response(object.body, { status: range ? 206 : 200, headers: {
            'Content-Type': 'application/octet-stream', 'Content-Length': String(range?.length ?? object.size),
            'Content-Disposition': 'attachment', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        } });
    }
    async delete(id: string) { await this.bucket.delete(id); }
}

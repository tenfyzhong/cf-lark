import { ServiceError } from '../domain/errors';
import type { Artifact, ArtifactBucket, ArtifactLedger, ArtifactUploadPort, ArtifactUploadRecord, ArtifactUploadSession, ArtifactUploadStore } from '../ports/artifacts';
const partSize = 64 * 1024 * 1024;
const publicSession = (record: ArtifactUploadRecord): ArtifactUploadSession => ({ id: record.id, size: record.size, partSize: record.partSize, partCount: record.partCount, expiresAt: record.expiresAt, status: record.status, parts: record.parts.map(part => part.partNumber) });
function uncertain(id: string): ServiceError { return new ServiceError('UPLOAD_UNCERTAIN', 'The upload outcome is uncertain. Inspect the session before proceeding; do not start another upload automatically.', 409, { uploadId: id }); }
function exact(body: ReadableStream<Uint8Array>, expected: number): ReadableStream<Uint8Array> {
    const reader = body.getReader(); let received = 0;
    return new ReadableStream<Uint8Array>({ async pull(controller) {
        try {
            const next = await reader.read();
            if (next.done) {
                if (received !== expected) throw new ServiceError('INVALID_SIZE', 'The part body is shorter than its declared length.');
                controller.close(); return;
            }
            received += next.value.byteLength;
            if (received > expected) throw new ServiceError('INVALID_SIZE', 'The part body exceeds its declared length.');
            controller.enqueue(next.value);
        } catch (error) { void reader.cancel().catch(() => {}); controller.error(error); }
    }, cancel(reason) { return reader.cancel(reason); } });
}
export class ArtifactUploadService implements ArtifactUploadPort {
    constructor(private readonly ledger: ArtifactLedger, private readonly bucket: ArtifactBucket, private readonly uploads: ArtifactUploadStore,
        private readonly now: () => number = Date.now, private readonly ttl = 86400) {}
    private async owned(owner: string, id: string, allowExpired = false) {
        const record = await this.uploads.get(id);
        if (!record || record.owner !== owner || (!allowExpired && record.expiresAt <= this.now())) throw new ServiceError('UPLOAD_NOT_FOUND', 'The upload session is unavailable.', 404);
        return record;
    }
    private async transition(record: ArtifactUploadRecord, patch: Partial<ArtifactUploadRecord>) {
        const next = { ...record, ...patch, revision: record.revision + 1 };
        if (!await this.uploads.transition(next, record.revision)) throw new ServiceError('UPLOAD_BUSY', 'The upload session changed; inspect its current state.', 409);
        return next;
    }
    async beginUpload(owner: string, size: number): Promise<ArtifactUploadSession> {
        if (!Number.isSafeInteger(size) || size <= 0 || size > 2_000_000_000) throw new ServiceError('INVALID_SIZE', 'Upload size must be positive and at most 2 GB.');
        if (!this.bucket.createMultipart || !this.bucket.uploadPart || !this.bucket.completeMultipart || !this.bucket.headSize || !this.bucket.abortMultipart) throw new ServiceError('UPLOAD_UNAVAILABLE', 'Resumable uploads are unavailable.', 503);
        const record: ArtifactUploadRecord = { id: crypto.randomUUID(), owner, size, partSize, partCount: Math.ceil(size / partSize), expiresAt: this.now() + this.ttl * 1000, revision: 0, status: 'creating', parts: [] };
        await this.ledger.consume('A');
        await this.ledger.reserve({ id: record.id, owner, size, expiresAt: record.expiresAt, state: 'reserved' });
        await this.uploads.create(record);
        await this.ledger.setMultipart(record.id, `unknown:${record.id}`);
        try {
            const uploadId = await this.bucket.createMultipart(record.id);
            if (!uploadId) throw new Error('Missing multipart ID');
            await this.ledger.setMultipart(record.id, uploadId);
            return publicSession(await this.transition(record, { status: 'uploading', uploadId }));
        } catch { throw uncertain(record.id); }
    }
    async getUpload(owner: string, id: string) { return publicSession(await this.owned(owner, id)); }
    async uploadPart(owner: string, id: string, partNumber: number, size: number, body: ReadableStream<Uint8Array>): Promise<ArtifactUploadSession> {
        const record = await this.owned(owner, id);
        const expectedSize = partNumber === record.partCount ? record.size - (partNumber - 1) * record.partSize : record.partSize;
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > record.partCount || !Number.isSafeInteger(size) || size !== expectedSize) throw new ServiceError('INVALID_PART', 'The part number and exact length must match the session plan.');
        if (record.parts.some(part => part.partNumber === partNumber)) { void body.cancel().catch(() => {}); return publicSession(record); }
        if (record.status !== 'uploading' || !record.uploadId) throw new ServiceError('UPLOAD_BUSY', 'The upload has an unfinished mutation; abort uncertain part uploads.', 409);
        if (partNumber !== record.parts.length + 1) throw new ServiceError('INVALID_PART', 'Parts must be uploaded in order.');
        if (!this.bucket.uploadPart) throw new ServiceError('UPLOAD_UNAVAILABLE', 'Multipart upload is unavailable.', 503);
        await this.ledger.consume('A');
        const claimed = await this.transition(record, { status: 'writing-part' });
        try {
            const receipt = await this.bucket.uploadPart(id, record.uploadId, partNumber, exact(body, size), size);
            if (receipt.partNumber !== partNumber || typeof receipt.etag !== 'string' || !receipt.etag || receipt.etag.length > 1024) throw new Error('Invalid multipart receipt');
            return publicSession(await this.transition(claimed, { status: 'uploading', parts: [...record.parts, receipt] }));
        } catch { throw uncertain(id); }
    }
    private async finish(record: ArtifactUploadRecord): Promise<Artifact> {
        await this.transition(record, { status: 'complete' });
        await this.ledger.ready(record.id);
        return { id: record.id, owner: record.owner, size: record.size, expiresAt: record.expiresAt, state: 'ready' };
    }
    async completeUpload(owner: string, id: string): Promise<Artifact> {
        const record = await this.owned(owner, id);
        if (record.status === 'complete') {
            const artifact = await this.ledger.get(id);
            if (!artifact) throw new ServiceError('UPLOAD_NOT_FOUND', 'The artifact has been removed.', 404);
            if (artifact.state !== 'ready') { await this.ledger.ready(id); return { ...artifact, state: 'ready' }; }
            return artifact;
        }
        if (record.status === 'completing') {
            if (!this.bucket.headSize) throw uncertain(id);
            await this.ledger.consume('B');
            const size = await this.bucket.headSize(id);
            if (size !== record.size) throw uncertain(id);
            return this.finish(record);
        }
        if (record.status !== 'uploading' || !record.uploadId) throw new ServiceError('UPLOAD_BUSY', 'The upload has an unfinished mutation.', 409);
        if (record.parts.length !== record.partCount) throw new ServiceError('INCOMPLETE_UPLOAD', 'All planned parts must be accepted before completion.', 409);
        if (!this.bucket.completeMultipart) throw new ServiceError('UPLOAD_UNAVAILABLE', 'Multipart completion is unavailable.', 503);
        await this.ledger.consume('A');
        const claimed = await this.transition(record, { status: 'completing' });
        try { await this.bucket.completeMultipart(id, record.uploadId, record.parts); return await this.finish(claimed); }
        catch { throw uncertain(id); }
    }
    async abortUpload(owner: string, id: string): Promise<void> {
        const record = await this.owned(owner, id, true);
        if (record.status === 'aborted') return;
        const uploadId = record.uploadId || await this.ledger.getMultipart(id);
        if (uploadId?.startsWith('unknown:')) throw uncertain(id);
        const claimed = await this.transition(record, { status: 'aborting' });
        if (uploadId) {
            if (!this.bucket.abortMultipart) throw new ServiceError('UPLOAD_UNAVAILABLE', 'Multipart abort is unavailable.', 503);
            await this.bucket.abortMultipart(id, uploadId);
        }
        await this.bucket.delete(id);
        await this.transition(claimed, { status: 'aborted' });
        await this.ledger.release(id);
    }
    async cleanup() { await this.uploads.prune(this.now()); }
}

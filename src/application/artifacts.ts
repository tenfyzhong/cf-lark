import { ServiceError } from '../domain/errors';
import type { Artifact, ArtifactBucket, ArtifactLedger, ArtifactRange } from '../ports/artifacts';

export class ArtifactService {
    constructor(private readonly ledger: ArtifactLedger, private readonly bucket: ArtifactBucket,
        private readonly now: () => number = Date.now, private readonly ttl = 86400) {}

    async upload(owner: string, size: number, body: ReadableStream<Uint8Array>): Promise<Artifact> {
        if (!Number.isSafeInteger(size) || size < 0) throw new ServiceError('INVALID_SIZE', 'An exact nonnegative content length is required.');
        await this.ledger.consume('A');
        const artifact: Artifact = { id: crypto.randomUUID(), owner, size, expiresAt: this.now() + this.ttl * 1000, state: 'reserved' };
        await this.ledger.reserve(artifact);
        await this.bucket.put(artifact.id, body, size);
        await this.ledger.ready(artifact.id);
        return { ...artifact, state: 'ready' };
    }

    async ingest(owner: string, maxBytes: number, body: ReadableStream<Uint8Array>): Promise<Artifact> {
        if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 2_000_000_000) throw new ServiceError('INVALID_SIZE', 'A positive maximum up to 2 GB is required.');
        if (!this.bucket.putUnknown) throw new ServiceError('STREAM_UNAVAILABLE', 'Streaming artifact ingestion is unavailable.', 500);
        const artifact: Artifact = { id: crypto.randomUUID(), owner, size: maxBytes, expiresAt: this.now() + this.ttl * 1000, state: 'reserved' };
        if (this.ledger.reserveUpTo) artifact.size = await this.ledger.reserveUpTo(artifact);
        else await this.ledger.reserve(artifact);
        const size = await this.bucket.putUnknown(artifact.id, body, artifact.size, () => this.ledger.consume('A'), (uploadId) => this.ledger.setMultipart(artifact.id, uploadId));
        await this.ledger.resize(artifact.id, size);
        await this.ledger.ready(artifact.id);
        return { ...artifact, size, state: 'ready' };
    }

    private async owned(owner: string, id: string, readable: boolean) {
        const artifact = await this.ledger.get(id);
        if (!artifact || artifact.owner !== owner || (readable && (artifact.state !== 'ready' || artifact.expiresAt <= this.now()))) {
            throw new ServiceError('ARTIFACT_NOT_FOUND', 'The artifact is unavailable.', 404);
        }
        return artifact;
    }

    stat(owner: string, id: string) { return this.owned(owner, id, true); }

    async read(owner: string, id: string, range?: ArtifactRange) {
        const artifact = await this.owned(owner, id, true);
        if (range && (!Number.isSafeInteger(range.offset) || !Number.isSafeInteger(range.length)
            || range.offset < 0 || range.length <= 0 || range.offset + range.length > artifact.size)) {
            throw new ServiceError('INVALID_RANGE', 'The requested byte range must be inside the artifact.', 416);
        }
        await this.ledger.consume('B');
        const response = await this.bucket.get(id, range);
        if (!response) throw new ServiceError('ARTIFACT_NOT_FOUND', 'The artifact is unavailable.', 404);
        return response;
    }

    async remove(owner: string, id: string) {
        await this.owned(owner, id, false);
        await this.bucket.delete(id);
        const uploadId = await this.ledger.getMultipart(id);
        if (uploadId) {
            if (!this.bucket.abortMultipart) throw new ServiceError('STREAM_UNAVAILABLE', 'Multipart cleanup is unavailable.', 500);
            await this.bucket.abortMultipart(id, uploadId);
        }
        await this.ledger.release(id);
    }

    async cleanup() {
        const expired = await this.ledger.expired(100);
        for (const artifact of expired) await this.remove(artifact.owner, artifact.id);
        return expired.length;
    }

    usage() { return this.ledger.usage(); }
}

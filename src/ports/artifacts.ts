export interface Artifact {
    id: string;
    owner: string;
    size: number;
    expiresAt: number;
    state: 'reserved' | 'ready';
}
export interface ArtifactLedger {
    reserve(artifact: Artifact): Promise<void>;
    reserveUpTo?(artifact: Artifact): Promise<number>;
    get(id: string): Promise<Artifact | undefined>;
    ready(id: string): Promise<void>;
    resize(id: string, size: number): Promise<void>;
    setMultipart(id: string, uploadId: string): Promise<void>;
    getMultipart(id: string): Promise<string | undefined>;
    release(id: string): Promise<void>;
    consume(kind: 'A' | 'B'): Promise<void>;
    expired(limit: number): Promise<Artifact[]>;
    usage(): Promise<{ bytes: number; classA: number; classB: number }>;
}
export interface ArtifactBucket {
    createMultipart?(id: string): Promise<string>;
    uploadPart?(id: string, uploadId: string, partNumber: number, body: ReadableStream<Uint8Array>, size: number): Promise<ArtifactPart>;
    completeMultipart?(id: string, uploadId: string, parts: ArtifactPart[]): Promise<void>;
    headSize?(id: string): Promise<number | undefined>;
    putUnknown?(id: string, body: ReadableStream<Uint8Array>, maximum: number, consume: () => Promise<void>, onUpload?: (uploadId: string) => Promise<void>): Promise<number>;
    abortMultipart?(id: string, uploadId: string): Promise<void>;
    put(id: string, body: ReadableStream<Uint8Array>, size: number): Promise<void>;
    get(id: string, range?: ArtifactRange): Promise<Response | null>;
    delete(id: string): Promise<void>;
}

export interface ArtifactStore extends Partial<ArtifactUploadPort> {
    ingest?(owner: string, maxBytes: number, body: ReadableStream<Uint8Array>): Promise<Artifact>;
    upload(owner: string, size: number, body: ReadableStream<Uint8Array>): Promise<Artifact>;
    read(owner: string, id: string, range?: ArtifactRange): Promise<Response>;
    remove(owner: string, id: string): Promise<void>;
}

export interface ArtifactRange { offset: number; length: number }
export interface ArtifactFiles extends ArtifactStore {
    stat(owner: string, id: string): Promise<Artifact>;
}

export interface ArtifactPart { partNumber: number; etag: string }
export interface ArtifactUploadRecord {
    id: string;
    owner: string;
    size: number;
    partSize: number;
    partCount: number;
    expiresAt: number;
    revision: number;
    status: 'creating' | 'uploading' | 'writing-part' | 'completing' | 'complete' | 'aborting' | 'aborted';
    uploadId?: string;
    parts: ArtifactPart[];
}
export interface ArtifactUploadSession {
    id: string;
    size: number;
    partSize: number;
    partCount: number;
    expiresAt: number;
    status: ArtifactUploadRecord['status'];
    parts: number[];
}
export interface ArtifactUploadStore {
    create(record: ArtifactUploadRecord): Promise<void>;
    get(id: string): Promise<ArtifactUploadRecord | undefined>;
    transition(record: ArtifactUploadRecord, expectedRevision: number): Promise<boolean>;
    prune(now: number): Promise<void>;
}
export interface ArtifactUploadPort {
    beginUpload(owner: string, size: number): Promise<ArtifactUploadSession>;
    getUpload(owner: string, id: string): Promise<ArtifactUploadSession>;
    uploadPart(owner: string, id: string, partNumber: number, size: number, body: ReadableStream<Uint8Array>): Promise<ArtifactUploadSession>;
    completeUpload(owner: string, id: string): Promise<Artifact>;
    abortUpload(owner: string, id: string): Promise<void>;
}

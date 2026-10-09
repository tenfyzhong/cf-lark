import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { ArtifactService } from '../src/application/artifacts';
import { SqliteArtifactLedger } from '../src/infrastructure/storage/artifact-ledger';

function setup(maxBytes = 10, maxA = 10) {
    const db = new DatabaseSync(':memory:');
    const sql = { exec(query: string, ...bindings: (string | number | null)[]) { return db.prepare(query).all(...bindings) as Record<string, unknown>[]; } };
    const bucket = { put: vi.fn(async () => {}), get: vi.fn(async () => new Response('data')), delete: vi.fn(async () => {}) };
    let now = Date.UTC(2026, 0, 1);
    const ledger = new SqliteArtifactLedger(sql, { maxBytes, maxClassA: maxA, maxClassB: 2 }, () => now);
    return { service: new ArtifactService(ledger, bucket, () => now), ledger, bucket, advance: (ms: number) => { now += ms; } };
}
const stream = () => new Response('data').body!;

it('reserves the exact cap, enforces ownership, and releases bytes only after confirmed deletion', async () => {
    const { service, bucket, ledger } = setup(4);
    const file = await service.upload('owner', 4, stream());
    expect((await ledger.usage()).bytes).toBe(4);
    await expect(service.upload('owner', 1, stream())).rejects.toMatchObject({ code: 'STORAGE_LIMIT' });
    await expect(service.read('other', file.id)).rejects.toMatchObject({ status: 404 });
    expect(bucket.get).not.toHaveBeenCalled();
    bucket.delete.mockRejectedValueOnce(new Error('network failure'));
    await expect(service.remove('owner', file.id)).rejects.toThrow();
    expect((await ledger.usage()).bytes).toBe(4);
    await service.remove('owner', file.id);
    expect((await ledger.usage()).bytes).toBe(0);
});

it('keeps failed uploads reserved and cleans expired objects even after operation exhaustion', async () => {
    const { service, bucket, ledger, advance } = setup(10, 1);
    bucket.put.mockRejectedValueOnce(new Error('interrupted'));
    await expect(service.upload('owner', 4, stream())).rejects.toThrow();
    expect((await ledger.usage()).bytes).toBe(4);
    await expect(service.upload('owner', 4, stream())).rejects.toMatchObject({ code: 'OPERATION_LIMIT' });
    advance(86400_000);
    await service.cleanup();
    expect(bucket.delete).toHaveBeenCalled();
    expect((await ledger.usage()).bytes).toBe(0);
});

it('counts read attempts, rejects expired files, and resets operation limits by UTC month', async () => {
    const { service, ledger, advance } = setup();
    const file = await service.upload('owner', 4, stream());
    await service.read('owner', file.id);
    await service.read('owner', file.id);
    await expect(service.read('owner', file.id)).rejects.toMatchObject({ code: 'OPERATION_LIMIT' });
    advance(86400_000 * 32);
    expect((await ledger.usage()).classB).toBe(0);
    await expect(service.read('owner', file.id)).rejects.toMatchObject({ status: 404 });
});

it('reads metadata without R2 and bounds every private artifact range', async () => {
    const { service, bucket } = setup(8);
    const file = await service.upload('owner', 8, stream());
    expect(await service.stat('owner', file.id)).toMatchObject({ id: file.id, size: 8 });
    expect(bucket.get).not.toHaveBeenCalled();
    await service.read('owner', file.id, { offset: 2, length: 3 });
    expect(bucket.get).toHaveBeenCalledExactlyOnceWith(file.id, { offset: 2, length: 3 });
    await expect(service.read('other', file.id, { offset: 0, length: 1 })).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' });
    for (const range of [{ offset: -1, length: 1 }, { offset: 7, length: 2 }, { offset: 0, length: 0 }, { offset: 0.5, length: 1 }]) {
        await expect(service.read('owner', file.id, range)).rejects.toMatchObject({ code: 'INVALID_RANGE' });
    }
    expect(bucket.get).toHaveBeenCalledTimes(1);
});

it('reserves unknown-length upload maxima and shrinks only after confirmed completion', async () => {
    const { ledger, bucket } = setup(10, 10);
    const putUnknown = vi.fn(async (_id: string, _body: ReadableStream<Uint8Array>, maximum: number, consume: () => Promise<void>) => {
        expect(maximum).toBe(10); expect((await ledger.usage()).bytes).toBe(10);
        await consume(); await consume(); await consume(); return 4;
    });
    const service = new ArtifactService(ledger, { ...bucket, putUnknown });
    const file = await service.ingest('owner', 10, stream());
    expect(file).toMatchObject({ size: 4, state: 'ready' });
    expect(await ledger.usage()).toMatchObject({ bytes: 4, classA: 3 });
    putUnknown.mockRejectedValueOnce(new Error('uncertain multipart completion'));
    await expect(service.ingest('owner', 6, stream())).rejects.toThrow();
    expect((await ledger.usage()).bytes).toBe(10);
});

it('retains uncertain multipart reservations until both the object and upload are removed', async () => {
    const { ledger, bucket, advance } = setup(10);
    const putUnknown = vi.fn(async (id: string, _body: ReadableStream<Uint8Array>, _maximum: number, _consume: () => Promise<void>, onUpload: (uploadId: string) => Promise<void>) => {
        await onUpload('pending-upload'); throw new Error('Lost response');
    });
    const abortMultipart = vi.fn(async () => {});
    const service = new ArtifactService(ledger, { ...bucket, putUnknown, abortMultipart }, () => Date.UTC(2026, 0, 1));
    await expect(service.ingest('owner', 10, stream())).rejects.toThrow('Lost response');
    advance(86400_000);
    abortMultipart.mockRejectedValueOnce(new Error('Abort unavailable'));
    await expect(service.cleanup()).rejects.toThrow('Abort unavailable');
    expect((await ledger.usage()).bytes).toBe(10);
    await service.cleanup(); expect((await ledger.usage()).bytes).toBe(0);
    expect(abortMultipart).toHaveBeenCalledTimes(2);
});

it('reserves available capacity atomically for unknown-length streams', async () => {
    const { ledger, bucket, service } = setup(10);
    await service.upload('existing', 4, stream());
    const putUnknown = vi.fn(async (_id, _body, maximum) => { expect(maximum).toBe(6); return 3; });
    const streaming = new ArtifactService(ledger, { ...bucket, putUnknown });
    const result = await streaming.ingest('owner', 10, stream());
    expect(result.size).toBe(3);
    expect((await ledger.usage()).bytes).toBe(7);
});
it('stores empty artifacts and shrinks streamed reservations to zero', async () => {
    const f = setup();
    const empty = await f.service.upload('owner', 0, new Response('').body!);
    expect(empty).toMatchObject({ size: 0, state: 'ready' });
    expect((await f.ledger.usage()).bytes).toBe(0);
    const service = new ArtifactService(f.ledger, { ...f.bucket, putUnknown: vi.fn().mockResolvedValue(0) });
    expect(await service.ingest('owner', 5, new Response('').body!)).toMatchObject({ size: 0, state: 'ready' });
    expect((await f.ledger.usage()).bytes).toBe(0);
});

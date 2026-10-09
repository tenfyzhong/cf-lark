import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { PrivateR2Bucket } from '../../src/infrastructure/storage/r2-bucket';
import { LarkHttpClient } from '../../src/infrastructure/lark/http-client';

it('streams a 100 MiB message file through native multipart without a file-sized buffer', async () => {
    const size = 100 * 1024 * 1024; let sent = 0; const chunk = new Uint8Array(1024 * 1024);
    const input = new ReadableStream<Uint8Array>({ pull(controller) { if (sent === size) controller.close(); else { sent += chunk.byteLength; controller.enqueue(chunk); } } });
    let total = 0;
    const client = new LarkHttpClient('feishu', async () => 'fixture-token', async (request) => {
        const reader = request.body!.getReader();
        while (true) { const next = await reader.read(); if (next.done) break; total += next.value.byteLength; }
        expect(total).toBe(Number(request.headers.get('Content-Length')));
        return Response.json({ data: { file_key: 'file_fixture' } });
    });
    expect(await client.uploadStream({ path: '/open-apis/im/v1/files', fields: { file_type: 'stream' }, file: { field: 'file', name: 'large.bin', size, body: input } })).toEqual({ file_key: 'file_fixture' });
    expect(total).toBeGreaterThan(size); expect(total).toBeLessThan(size + 1024);
});

it('ingests an unknown-length stream through actual private R2 multipart binding', async () => {
    const bucket = new PrivateR2Bucket((env as unknown as { ARTIFACTS: R2Bucket }).ARTIFACTS, 5 * 1024 * 1024);
    const id = `multipart-${crypto.randomUUID()}`; const size = 11 * 1024 * 1024;
    let written = 0; let uploadId = ''; let operations = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
        if (written === size) { controller.close(); return; }
        const chunk = new Uint8Array(Math.min(1024 * 1024, size - written)).fill(42); written += chunk.byteLength; controller.enqueue(chunk);
    } });
    expect(await bucket.putUnknown(id, stream, size, async () => { operations++; }, async (value) => { uploadId = value; })).toBe(size);
    expect(operations).toBe(5);
    const result = await bucket.get(id, { offset: size - 3, length: 3 });
    expect(new Uint8Array(await result!.arrayBuffer())).toEqual(new Uint8Array([42, 42, 42]));
    await bucket.abortMultipart(id, uploadId);
    await bucket.delete(id);
});

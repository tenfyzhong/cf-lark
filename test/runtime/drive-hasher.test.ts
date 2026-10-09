import { expect, it } from 'vitest';
import { CloudflareContentHasher } from '../../src/infrastructure/crypto/content-hasher';
it('hashes chunked content using the native streaming SHA-256 implementation', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const text of ['a', 'b', 'c']) controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
    expect(await new CloudflareContentHasher().sha256(stream)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
it('propagates input stream errors instead of returning a partial digest', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('broken input')); } });
    await expect(new CloudflareContentHasher().sha256(stream)).rejects.toThrow('broken input');
});

import { expect, it } from 'vitest';
import { scanImageMetadata } from '../src/capabilities/sheets/image-metadata';
async function dimensions(bytes: Uint8Array) {
    let state: any = {};
    for (let n = 0; n < 100; n++) {
        const offset = state.offset ?? 0;
        const result = scanImageMetadata(bytes.slice(offset, offset + 65536), state, bytes.length);
        if (result.done) return result.dimensions;
        state = result.state;
    }
    throw new Error('Unbounded metadata scan');
}
it('follows JPEG segments beyond one megabyte with bounded reads', async () => {
    const bytes = new Uint8Array(18 * 65537 + 20); bytes.set([255, 216]);
    let offset = 2;
    for (let n = 0; n < 18; n++) { bytes.set([255, 225, 255, 255], offset); offset += 65537; }
    bytes.set([255, 192, 0, 11, 8, 0, 12, 0, 23, 1, 1, 17, 0], offset);
    expect(await dimensions(bytes)).toEqual({ width: 23, height: 12 });
});
it('follows WebP chunks beyond one megabyte without reading skipped payloads', async () => {
    const at = 1200000, bytes = new Uint8Array(at + 30), view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode('RIFF')); view.setUint32(4, bytes.length - 8, true); bytes.set(new TextEncoder().encode('WEBPJUNK'), 8); view.setUint32(16, at - 20, true);
    bytes.set(new TextEncoder().encode('VP8X'), at); view.setUint32(at + 4, 10, true); bytes[at + 12] = 22; bytes[at + 15] = 11;
    expect(await dimensions(bytes)).toEqual({ width: 23, height: 12 });
});
it('follows TIFF directory offsets beyond one megabyte', async () => {
    const at = 1200000, bytes = new Uint8Array(at + 30), view = new DataView(bytes.buffer);
    bytes.set([73, 73, 42, 0]); view.setUint32(4, at, true); view.setUint16(at, 2, true);
    for (const [n, tag, value] of [[0, 256, 23], [1, 257, 12]]) { const p = at + 2 + n! * 12; view.setUint16(p, tag!, true); view.setUint16(p + 2, 4, true); view.setUint32(p + 4, 1, true); view.setUint32(p + 8, value!, true); }
    expect(await dimensions(bytes)).toEqual({ width: 23, height: 12 });
});
it('rejects invalid offsets and truncated metadata before upload', async () => {
    await expect(dimensions(new Uint8Array([73, 73, 42, 0, 255, 255, 255, 255]))).rejects.toThrow();
    await expect(dimensions(new Uint8Array([255, 216, 255, 225, 255, 255]))).rejects.toThrow();
});

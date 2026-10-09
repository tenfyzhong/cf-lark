import { expect, it } from 'vitest';
import { imageDimensions } from '../src/capabilities/base/image-dimensions';
const read = (bytes: Uint8Array) => async (offset: number, length: number) => bytes.slice(offset, offset + length);
it.each([false, true])('reads classic TIFF scalar dimensions with endian=%s', async little => {
    const bytes = new Uint8Array(40), view = new DataView(bytes.buffer);
    bytes.set(little ? [73, 73, 42, 0] : [77, 77, 0, 42]); view.setUint32(4, 8, little); view.setUint16(8, 2, little);
    for (let i = 0; i < 2; i++) { const o = 10 + i * 12; view.setUint16(o, 256 + i, little); view.setUint16(o + 2, 4, little); view.setUint32(o + 4, 1, little); view.setUint32(o + 8, 320 + i * 160, little); }
    expect(await imageDimensions(read(bytes), bytes.length)).toEqual({ image_width: 320, image_height: 480 });
});
it('reads BMP top-down dimensions without image decompression', async () => {
    const bytes = new Uint8Array(54), view = new DataView(bytes.buffer); bytes.set([66, 77]); view.setUint32(10, 54, true); view.setUint32(14, 40, true); view.setInt32(18, 32, true); view.setInt32(22, -64, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true);
    expect(await imageDimensions(read(bytes), bytes.length)).toEqual({ image_width: 32, image_height: 64 });
});
it('reads WebP extended canvas dimensions and ignores reserved bits', async () => {
    const bytes = new Uint8Array(30), view = new DataView(bytes.buffer); bytes.set(new TextEncoder().encode('RIFF')); view.setUint32(4, 22, true); bytes.set(new TextEncoder().encode('WEBPVP8X'), 8); view.setUint32(16, 10, true); bytes[20] = 255; bytes[24] = 31; bytes[27] = 63;
    expect(await imageDimensions(read(bytes), bytes.length)).toEqual({ image_width: 32, image_height: 64 });
});
it('follows JPEG metadata beyond the first 64 KiB', async () => {
    const bytes = new Uint8Array(65550), view = new DataView(bytes.buffer); bytes.set([255, 216, 255, 225]); view.setUint16(4, 65535); bytes.set([255, 192], 65539); view.setUint16(65541, 9); bytes[65543] = 8; view.setUint16(65544, 123); view.setUint16(65546, 456);
    expect(await imageDimensions(read(bytes), bytes.length)).toEqual({ image_width: 456, image_height: 123 });
});
it('leaves malformed or unsupported image dimensions absent', async () => {
    expect(await imageDimensions(read(new Uint8Array([1, 2, 3])), 3)).toEqual({});
});
it('uses extension MIME precedence and strict UTF-8 text sniffing', async () => {
    const { attachmentMetadata } = await import('../src/capabilities/base/attachment-metadata');
    const png = new Uint8Array(24); png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(attachmentMetadata(png, 'misnamed.txt')).toEqual({ mime_type: 'text/plain' });
    expect(attachmentMetadata(new Uint8Array([255, 255, 255]), 'file')).toEqual({ mime_type: 'application/octet-stream' });
    expect(attachmentMetadata(new Uint8Array(), 'file')).toEqual({ mime_type: 'application/octet-stream' });
    expect(attachmentMetadata(new TextEncoder().encode('%PDF-1.4'), 'file')).toEqual({ mime_type: 'application/pdf' });
});

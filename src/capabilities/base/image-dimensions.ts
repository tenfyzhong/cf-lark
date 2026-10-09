import type { JsonObject } from '../../domain/models';
type Reader = (offset: number, length: number) => Promise<Uint8Array>;
const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);
function view(bytes: Uint8Array) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function size(width: number, height: number): JsonObject { return width > 0 && height > 0 ? { image_width: width, image_height: height } : {}; }
/** Reads image headers only; source ranges and format traversal are bounded. */
export async function imageDimensions(read: Reader, fileSize: number): Promise<JsonObject> {
    const get = async (offset: number, length: number) => {
        if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || offset + length > fileSize) throw new Error('Invalid image metadata range');
        const bytes = await read(offset, length); if (bytes.length !== length) throw new Error('Truncated image metadata'); return bytes;
    };
    try {
        const header = await get(0, Math.min(fileSize, 32));
        const dv = view(header);
        if (header.length >= 24 && text(header.slice(0, 8)) === '\x89PNG\r\n\x1a\n') return size(dv.getUint32(16), dv.getUint32(20));
        if (header.length >= 10 && ['GIF87a', 'GIF89a'].includes(text(header.slice(0, 6)))) return size(dv.getUint16(6, true), dv.getUint16(8, true));
        if (header[0] === 255 && header[1] === 216) {
            let offset = 2;
            while (offset + 4 <= fileSize) {
                const h = await get(offset, 4); if (h[0] !== 255) return {};
                const marker = h[1]!;
                if (marker === 255) { offset++; continue; }
                if (marker === 216 || (marker >= 208 && marker <= 215) || marker === 1) { offset += 2; continue; }
                if (marker === 217 || marker === 218) return {};
                const length = view(h).getUint16(2); if (length < 2 || offset + length + 2 > fileSize) return {};
                if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
                    if (length < 7) return {}; const dimensions = view(await get(offset + 5, 4)); return size(dimensions.getUint16(2), dimensions.getUint16(0));
                }
                offset += length + 2;
            }
            return {};
        }
        if (['II\x2a\0', 'MM\0\x2a'].includes(text(header.slice(0, 4)))) {
            const little = header[0] === 73, offset = dv.getUint32(4, little);
            if (offset < 8) return {};
            const count = view(await get(offset, 2)).getUint16(0, little);
            const entries = view(await get(offset + 2, count * 12));
            const values: number[] = [];
            for (let i = 0; i < count; i++) {
                const o = i * 12, tag = entries.getUint16(o, little); if (tag !== 256 && tag !== 257) continue;
                const idx = tag - 256;
                if (values[idx] !== undefined || entries.getUint32(o + 4, little) !== 1) return {};
                const type = entries.getUint16(o + 2, little);
                if (type !== 3 && type !== 4) return {};
                values[idx] = type === 3 ? entries.getUint16(o + 8, little) : entries.getUint32(o + 8, little);
            }
            return size(values[0] ?? 0, values[1] ?? 0);
        }
        if (text(header.slice(0, 2)) === 'BM') {
            const length = dv.getUint32(14, true); if (![40, 108, 124].includes(length)) return {};
            const bmp = view(await get(0, 14 + length));
            const width = bmp.getInt32(18, true), height = Math.abs(bmp.getInt32(22, true)), bits = bmp.getUint16(28, true), compression = bmp.getUint32(30, true);
            if (bmp.getUint16(26, true) !== 1 || ![1, 2, 4, 8, 24, 32].includes(bits)) return {};
            if (compression !== 0 && (compression !== 3 || length === 40 || bmp.getUint32(54, true) !== 0xff0000 || bmp.getUint32(58, true) !== 0xff00 || bmp.getUint32(62, true) !== 0xff || bmp.getUint32(66, true) !== 0xff000000)) return {};
            let expected = 14 + length;
            if (bits <= 8) { const colors = bmp.getUint32(46, true) || 1 << bits; if (colors > 1 << bits) return {}; await get(expected, colors * 4); expected += colors * 4; }
            return bmp.getUint32(10, true) === expected ? size(width, height) : {};
        }
        if (text(header.slice(0, 4)) === 'RIFF' && text(header.slice(8, 12)) === 'WEBP') {
            const end = dv.getUint32(4, true) + 8; if (end < 20 || end > 2 ** 32 - 2) return {};
            let offset = 12;
            for (let i = 0; i < 4096 && offset + 8 <= end; i++) {
                const chunk = await get(offset, 8), kind = text(chunk.slice(0, 4)), length = view(chunk).getUint32(4, true);
                if (offset + 8 + length > end) return {};
                const needed = kind === 'VP8L' ? 5 : ['VP8 ', 'VP8X'].includes(kind) ? 10 : 0;
                if (needed) {
                    if (length < needed) return {};
                    const data = await get(offset + 8, needed), dv = view(data);
                    if (kind === 'VP8 ') return !(data[0]! & 1) && text(data.slice(3, 6)) === '\x9d\x01\x2a' ? size(dv.getUint16(6, true) & 0x3fff, dv.getUint16(8, true) & 0x3fff) : {};
                    if (kind === 'VP8L') { if (data[0] !== 47 || data[4]! >> 5 !== 0) return {}; const packed = dv.getUint32(1, true); return size((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1); }
                    if (length !== 10) return {};
                    return size(data[4]! + data[5]! * 256 + data[6]! * 65536 + 1, data[7]! + data[8]! * 256 + data[9]! * 65536 + 1);
                }
                offset += 8 + length + (length & 1);
            }
        }
        return {};
    } catch { return {}; }
}

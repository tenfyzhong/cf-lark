import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
type Result = { done: true; dimensions: { width: number; height: number } } | { done: false; state: JsonObject };
function invalid(): never { throw new ServiceError('INVALID_IMAGE', 'The image metadata is invalid, truncated, or unsupported.'); }
function complete(width: number, height: number): Result { if (!(width > 0 && height > 0)) invalid(); return { done: true, dimensions: { width, height } }; }
/** Parse one bounded range, returning the absolute range offset for the next checkpoint. */
export function scanImageMetadata(bytes: Uint8Array, state: JsonObject, size: number): Result {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), base = Number(state.offset ?? 0);
    const next = (offset: number, patch: JsonObject = {}): Result => { if (!Number.isSafeInteger(offset) || offset < 0 || offset >= size || offset === base) invalid(); return { done: false, state: { ...state, ...patch, offset } }; };
    let kind = state.kind as string, pos = 0;
    if (!kind) {
        if (bytes.length < 8) invalid();
        const magic = view.getUint32(0);
        if (magic === 0x89504e47 && bytes.length >= 24 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) return complete(view.getUint32(16), view.getUint32(20));
        if (['GIF87a', 'GIF89a'].includes(new TextDecoder().decode(bytes.subarray(0, 6))) && bytes.length >= 10) return complete(view.getUint16(6, true), view.getUint16(8, true));
        if (bytes[0] === 66 && bytes[1] === 77 && bytes.length >= 54) {
            const dib = view.getUint32(14, true), width = view.getInt32(18, true), height = view.getInt32(22, true), planes = view.getUint16(26, true), bits = view.getUint16(28, true), compression = view.getUint32(30, true), pixels = view.getUint32(10, true);
            if (![40, 108, 124].includes(dib) || planes !== 1 || ![1, 4, 8, 16, 24, 32].includes(bits) || ![0, 3].includes(compression) || pixels < 14 + dib || pixels > size || width <= 0 || height === -2147483648) invalid();
            return complete(width, Math.abs(height));
        }
        if (bytes[0] === 255 && bytes[1] === 216) { kind = 'jpeg'; pos = 2; }
        else if (magic === 0x52494646 && bytes.length >= 12 && view.getUint32(8) === 0x57454250) { kind = 'webp'; pos = 12; state = { ...state, end: view.getUint32(4, true) + 8 }; if (Number(state.end) > size) invalid(); }
        else if ([0x49492a00, 0x4d4d002a].includes(magic)) { const little = bytes[0] === 73, offset = view.getUint32(4, little); if (offset < 8) invalid(); return next(offset, { kind: 'tiff-count', little }); }
        else invalid();
        state = { ...state, kind };
    }
    if (kind === 'jpeg') {
        for (let count = 0; count < 512; count++) {
            if (pos + 10 > bytes.length) return next(base + pos, { kind });
            if (bytes[pos++] !== 255) invalid();
            let marker = bytes[pos++]!;
            while (marker === 255) { if (pos >= bytes.length) return next(base + pos - 1, { kind }); marker = bytes[pos++]!; }
            if (marker === 0xd9 || marker === 0xda || marker === 0) invalid();
            if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) continue;
            const length = view.getUint16(pos);
            if (length < 2 || base + pos + length > size) invalid();
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) { if (length < 8) invalid(); return complete(view.getUint16(pos + 5), view.getUint16(pos + 3)); }
            pos += length;
            if (pos + 10 > bytes.length) return next(base + pos, { kind });
        }
        return next(base + pos, { kind });
    }
    if (kind === 'webp') {
        const end = Number(state.end);
        for (let count = 0; count < 512; count++) {
            if (base + pos + 8 > end) invalid();
            if (pos + 18 > bytes.length) return next(base + pos, { kind });
            const chunk = view.getUint32(pos), length = view.getUint32(pos + 4, true), at = pos + 8;
            if (base + at + length > end) invalid();
            if (chunk === 0x56503858 && length === 10) return complete((bytes[at + 4]! | bytes[at + 5]! << 8 | bytes[at + 6]! << 16) + 1, (bytes[at + 7]! | bytes[at + 8]! << 8 | bytes[at + 9]! << 16) + 1);
            if (chunk === 0x5650384c && length >= 5 && bytes[at] === 0x2f && bytes[at + 4]! >> 5 === 0) { const bits = view.getUint32(at + 1, true); return complete((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1); }
            if (chunk === 0x56503820 && length >= 10 && !(bytes[at]! & 1) && bytes[at + 3] === 0x9d && bytes[at + 4] === 1 && bytes[at + 5] === 0x2a) return complete(view.getUint16(at + 6, true) & 0x3fff, view.getUint16(at + 8, true) & 0x3fff);
            pos = at + length + (length & 1);
            if (pos + 18 > bytes.length) return next(base + pos, { kind });
        }
        return next(base + pos, { kind });
    }
    if (kind === 'tiff-count' || kind === 'tiff-entries') {
        const little = state.little === true;
        let remaining = Number(state.remaining), width = Number(state.width ?? 0), height = Number(state.height ?? 0);
        if (kind === 'tiff-count') { if (bytes.length < 2) invalid(); remaining = view.getUint16(0, little); pos = 2; if (base + pos + remaining * 12 + 4 > size) invalid(); }
        for (let count = 0; remaining && count < 512; count++, remaining--, pos += 12) {
            if (pos + 12 > bytes.length) break;
            const tag = view.getUint16(pos, little); if (tag !== 256 && tag !== 257) continue;
            const type = view.getUint16(pos + 2, little);
            if (![3, 4].includes(type) || view.getUint32(pos + 4, little) !== 1 || (tag === 256 ? width : height)) invalid();
            const value = type === 3 ? view.getUint16(pos + 8, little) : view.getUint32(pos + 8, little);
            if (tag === 256) width = value; else height = value;
        }
        if (!remaining) return complete(width, height);
        return next(base + pos, { kind: 'tiff-entries', remaining, width, height, little });
    }
    return invalid();
}

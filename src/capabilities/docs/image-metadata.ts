import type { JsonObject } from '../../domain/models';
export function imageDimensions(
    bytes: Uint8Array,
): { width: number; height: number } | undefined {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
        bytes.length >= 24 &&
        bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71
    )
        return { width: view.getUint32(16), height: view.getUint32(20) };
    if (
        bytes.length >= 10 &&
        String.fromCharCode(...bytes.slice(0, 3)) === 'GIF'
    )
        return {
            width: view.getUint16(6, true),
            height: view.getUint16(8, true),
        };
    if (bytes[0] === 255 && bytes[1] === 216) {
        let offset = 2;
        while (offset + 4 < bytes.length) {
            if (bytes[offset] !== 255) break;
            const marker = bytes[offset + 1]!;
            if (marker === 216 || marker === 217) {
                offset += 2;
                continue;
            }
            const size = view.getUint16(offset + 2);
            if (size < 2 || offset + size + 2 > bytes.length) break;
            if (
                [
                    192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206,
                    207,
                ].includes(marker) &&
                size >= 7
            )
                return {
                    width: view.getUint16(offset + 7),
                    height: view.getUint16(offset + 5),
                };
            offset += 2 + size;
        }
    }
    if (bytes.length >= 26 && bytes[0] === 66 && bytes[1] === 77) {
        const header = view.getUint32(14, true);
        if (header === 12)
            return {
                width: view.getUint16(18, true),
                height: view.getUint16(20, true),
            };
        if (header >= 40)
            return {
                width: Math.abs(view.getInt32(18, true)),
                height: Math.abs(view.getInt32(22, true)),
            };
    }
    if (
        bytes.length >= 30 &&
        String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
        String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    ) {
        const format = String.fromCharCode(...bytes.slice(12, 16));
        const u24 = (o: number) =>
            bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16);
        if (format === 'VP8X')
            return { width: u24(24) + 1, height: u24(27) + 1 };
        if (
            format === 'VP8 ' &&
            bytes[23] === 157 &&
            bytes[24] === 1 &&
            bytes[25] === 42
        )
            return {
                width: view.getUint16(26, true) & 16383,
                height: view.getUint16(28, true) & 16383,
            };
        if (format === 'VP8L' && bytes[20] === 47) {
            const bits = view.getUint32(21, true);
            return {
                width: (bits & 16383) + 1,
                height: ((bits >>> 14) & 16383) + 1,
            };
        }
    }
    if (
        bytes.length >= 8 &&
        ((bytes[0] === 73 && bytes[1] === 73) ||
            (bytes[0] === 77 && bytes[1] === 77))
    ) {
        const little = bytes[0] === 73;
        if (view.getUint16(2, little) !== 42) return undefined;
        const offset = view.getUint32(4, little);
        if (offset + 2 > bytes.length) return undefined;
        const count = view.getUint16(offset, little);
        if (count > 4096 || offset + 2 + count * 12 > bytes.length)
            return undefined;
        let width = 0,
            height = 0;
        for (let i = 0; i < count; i++) {
            const o = offset + 2 + i * 12,
                key = view.getUint16(o, little),
                type = view.getUint16(o + 2, little),
                n = view.getUint32(o + 4, little);
            if (n !== 1 || ![3, 4].includes(type)) continue;
            const value =
                type === 3
                    ? view.getUint16(o + 8, little)
                    : view.getUint32(o + 8, little);
            if (key === 256) width = value;
            if (key === 257) height = value;
        }
        if (width && height) return { width, height };
    }
    return undefined;
}

export function normalizeImagePresentation(
    input: JsonObject,
    native: { width: number; height: number },
): JsonObject {
    const positive = (value: unknown) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const display = (value: unknown, size: number) =>
        typeof value === 'string' && value.trim().endsWith('%')
            ? positive(value.trim().slice(0, -1)) === undefined
                ? undefined
                : (Number(value.trim().slice(0, -1)) * size) / 100
            : positive(value);
    const width = display(input.width, native.width),
        height = display(input.height, native.height);
    let scale =
        positive(input.scale) ??
        (width
            ? width / native.width
            : height
              ? height / native.height
              : native.width >= 1020
                ? 1
                : undefined);
    if (scale !== undefined) {
        const floor = Math.floor(scale * 1000000) / 1000000;
        if (floor > 0) scale = floor;
        const maximum = 1020 / native.width;
        if (scale >= maximum) {
            scale = Math.floor(maximum * 1000000) / 1000000;
            if (scale >= maximum) scale -= 0.000001;
            if (scale <= 0) scale = maximum * (1 - Number.EPSILON);
        }
    }
    const { scale: _scale, width: _width, height: _height, ...rest } = input;
    return {
        ...rest,
        width: native.width,
        height: native.height,
        ...(scale !== undefined ? { scale } : {}),
    };
}

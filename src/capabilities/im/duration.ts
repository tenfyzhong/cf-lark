export function oggDuration(bytes: Uint8Array): number {
    for (let offset = bytes.length - 4; offset >= 0; offset--) {
        if (bytes[offset] !== 79 || bytes[offset + 1] !== 103 || bytes[offset + 2] !== 103 || bytes[offset + 3] !== 83) continue;
        if (offset + 14 > bytes.length) return 0;
        const granule = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset + 6, true);
        return Math.ceil(Number(granule) / 48000) * 1000;
    }
    return 0;
}
export function boxHeader(bytes: Uint8Array, available: number): { type: string; size: number; header: number } | undefined {
    if (bytes.length < 8) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const initial = view.getUint32(0);
    const header = initial === 1 ? 16 : 8;
    if (bytes.length < header) return;
    const big = initial === 1 ? view.getBigUint64(8) : BigInt(initial || available);
    if (big > BigInt(available) || big < BigInt(header)) return;
    return { type: new TextDecoder().decode(bytes.subarray(4, 8)), size: Number(big), header };
}
function findBox(bytes: Uint8Array, wanted: string): Uint8Array | undefined {
    let offset = 0;
    while (offset + 8 <= bytes.length) {
        const box = boxHeader(bytes.subarray(offset, offset + 16), bytes.length - offset);
        if (!box) return;
        if (box.type === wanted) return bytes.subarray(offset + box.header, offset + box.size);
        offset += box.size;
    }
    return;
}
export function movieDuration(bytes: Uint8Array): number {
    const header = findBox(bytes, 'mvhd');
    if (!header?.length) return 0;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const version = header[0];
    if (header.length < (version === 0 ? 20 : 32)) return 0;
    const scale = view.getUint32(version === 0 ? 12 : 20);
    const duration = version === 0 ? view.getUint32(16) : Number(view.getBigUint64(24));
    return scale && duration ? Math.round(duration / scale * 1000) : 0;
}
export function mp4Duration(bytes: Uint8Array): number {
    const movie = findBox(bytes, 'moov');
    return movie ? movieDuration(movie) : 0;
}

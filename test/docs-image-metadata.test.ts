import { describe, it, expect } from 'vitest';
import {
    imageDimensions,
    normalizeImagePresentation,
} from '../src/capabilities/docs/image-metadata';
describe('document image metadata', () => {
    it('reads BMP dimensions without decoding pixels', () => {
        const b = new Uint8Array(30);
        b.set([66, 77]);
        const d = new DataView(b.buffer);
        d.setUint32(14, 40, true);
        d.setInt32(18, 1200, true);
        d.setInt32(22, -600, true);
        expect(imageDimensions(b)).toEqual({ width: 1200, height: 600 });
    });
    it('reads VP8X canvas metadata', () => {
        const b = new Uint8Array(30);
        b.set(new TextEncoder().encode('RIFF'));
        b.set(new TextEncoder().encode('WEBPVP8X'), 8);
        b[24] = 99;
        b[27] = 49;
        expect(imageDimensions(b)).toEqual({ width: 100, height: 50 });
    });
    it('reads TIFF short dimensions in either byte order', () => {
        for (const little of [true, false]) {
            const b = new Uint8Array(38);
            const d = new DataView(b.buffer);
            b.set(little ? [73, 73] : [77, 77]);
            d.setUint16(2, 42, little);
            d.setUint32(4, 8, little);
            d.setUint16(8, 2, little);
            for (const [i, key, value] of [
                [0, 256, 640],
                [1, 257, 480],
            ]) {
                const o = 10 + i! * 12;
                d.setUint16(o, key!, little);
                d.setUint16(o + 2, 3, little);
                d.setUint32(o + 4, 1, little);
                d.setUint16(o + 8, value!, little);
            }
            expect(imageDimensions(b)).toEqual({ width: 640, height: 480 });
        }
    });
    it('converts percentage display sizes to scale below the page width', () => {
        expect(
            normalizeImagePresentation(
                { width: '50%' },
                { width: 1200, height: 600 },
            ),
        ).toEqual({ width: 1200, height: 600, scale: 0.5 });
        expect(
            normalizeImagePresentation({}, { width: 1200, height: 600 }),
        ).toMatchObject({ scale: 0.849999 });
    });
});

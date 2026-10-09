import { expect, it } from 'vitest';
import { oggDuration, mp4Duration } from '../src/capabilities/im/duration';
it('uses the final Ogg granule and rejects truncated or empty packets', () => {
    const bytes = new Uint8Array(32);
    bytes.set(new TextEncoder().encode('OggS'), 2);
    new DataView(bytes.buffer).setBigUint64(8, 48001n, true);
    expect(oggDuration(bytes)).toBe(2000);
    expect(oggDuration(bytes.slice(0, 10))).toBe(0);
});
it('reads MP4 movie headers and rejects overflowing extended boxes', () => {
    const bytes = new Uint8Array(36), view = new DataView(bytes.buffer);
    view.setUint32(0, 36); bytes.set(new TextEncoder().encode('moov'), 4);
    view.setUint32(8, 28); bytes.set(new TextEncoder().encode('mvhd'), 12);
    view.setUint32(28, 1000); view.setUint32(32, 1234);
    expect(mp4Duration(bytes)).toBe(1234);
    view.setUint32(0, 1); view.setBigUint64(8, 2n ** 63n);
    expect(mp4Duration(bytes)).toBe(0);
});

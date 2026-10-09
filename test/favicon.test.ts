import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

it('declares a local PNG favicon with a square image payload', async () => {
    const html = await readFile('ui/index.html', 'utf8');
    expect(html).toContain('<link rel="icon" type="image/png" href="/favicon.png" />');
    const png = await readFile('ui/public/favicon.png');
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(header.getUint32(16)).toBe(header.getUint32(20));
    expect(header.getUint32(16)).toBeGreaterThanOrEqual(32);
});

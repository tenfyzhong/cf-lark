import { expect, it } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { buildHeadlessProbe } from '../scripts/wasm/build';

it.skipIf(!process.env.LARK_CLI_SOURCE)('builds the pinned CLI without modifying its checkout or module cache', async () => {
    const result = await buildHeadlessProbe(process.env.LARK_CLI_SOURCE!);
    try {
        const bytes = await readFile(result.path);
        expect(bytes.byteLength).toBeLessThan(64 * 1024 * 1024);
        expect(WebAssembly.validate(bytes)).toBe(true);
    } finally { await rm(result.directory, { recursive: true, force: true }); }
}, 360_000);

import { SELF } from 'cloudflare:test';
import { RemotePureEngine } from '../../src/infrastructure/http/pure-engine';
import { expect, it } from 'vitest';
import module from '../../src/infrastructure/documents/generated/docs/parser.wasm';
import { Go } from '../../src/infrastructure/documents/generated/runtime.js';

it('characterizes exact parsing of near-ceiling text-heavy XML', async () => {
    const go = new Go();
    const instance = await WebAssembly.instantiate(module, go.importObject);
    void go.run(instance);
    const words = 3_900_000;
    const xml = `<p>${'word '.repeat(words)}</p>`;
    const started = Date.now();
    const profile = JSON.parse((globalThis as any).cfLarkParseDocXML(xml));
    const bytes = (instance.exports.mem as WebAssembly.Memory).buffer
        .byteLength;
    console.log(
        JSON.stringify({
            shape: 'text',
            xmlBytes: xml.length,
            milliseconds: Date.now() - started,
            wasmMemoryBytes: bytes,
        }),
    );
    expect(profile.word_count).toBe(words);
    expect(profile.block_count).toBe(1);
    expect(bytes).toBeLessThan(96 * 1024 * 1024);
}, 30_000);

it('profiles near-ceiling XML at the hosted structural boundary', async () => {
    const go = new Go();
    const instance = await WebAssembly.instantiate(module, go.importObject);
    void go.run(instance);
    const nodes = 16_382;
    const xml = `<document>${`<p>${'word '.repeat(240)}</p>`.repeat(nodes)}</document>`;
    const started = Date.now();
    const profile = JSON.parse((globalThis as any).cfLarkParseDocXML(xml));
    const bytes = (instance.exports.mem as WebAssembly.Memory).buffer
        .byteLength;
    console.log(
        JSON.stringify({
            shape: 'nodes',
            xmlBytes: xml.length,
            milliseconds: Date.now() - started,
            wasmMemoryBytes: bytes,
        }),
    );
    expect(profile.word_count).toBe(nodes * 240);
    expect(profile.block_count).toBe(nodes);
    expect(bytes).toBeLessThan(96 * 1024 * 1024);
}, 30_000);

it('rejects the measured unsafe near-ceiling node-heavy input through the private engine', async () => {
    const xml = `<document>${`<p>${'word '.repeat(37)}</p>`.repeat(100_000)}</document>`;
    await expect(new RemotePureEngine(SELF).parse(xml)).rejects.toMatchObject({
        code: 'RESOURCE_LIMIT',
        message: expect.stringContaining('32,768'),
    });
}, 30_000);

it('profiles a large accepted document through the real private-engine request path', async () => {
    const words = 3_900_000;
    const profile = await new RemotePureEngine(SELF).parse(
        `<p>${'word '.repeat(words)}</p>`,
    );
    expect(profile.word_count).toBe(words);
    expect(profile.block_count).toBe(1);
}, 30_000);

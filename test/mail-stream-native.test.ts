import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { WasmDocumentParser } from '../src/infrastructure/documents/engine';
import { streamMailDraftJSON } from '../src/capabilities/mail/stream';
it('streams exact pinned MIME part headers and payloads without Wasm attachment copies', async () => {
    const module = await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/mail/parser.wasm',
                    import.meta.url,
                ),
            ),
        ),
        pure = new WasmDocumentParser(module),
        bytes = new Uint8Array(262145);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const stream = await streamMailDraftJSON(
        {
            from: { address: 'a@example.com' },
            to: [{ address: 'b@example.com' }],
            subject: 'S',
            text: 'Body',
        },
        [
            {
                file: { id: 'file', name: 'data.bin.txt', internal: true },
                kind: 'attachment',
            },
        ],
        { grant: { id: 'g' } } as never,
        {
            stat: async () => ({ size: bytes.length }),
            read: async () => new Response(bytes),
        } as never,
        pure,
    );
    const json = JSON.parse(await new Response(stream).text()),
        raw = Buffer.from(json.raw, 'base64url').toString();
    expect(raw).not.toContain('\r');
    const encoded = raw
        .split(
            'filename="data.bin.txt"\nContent-Transfer-Encoding: base64\n\n',
        )[1]
        ?.split('\n--')[0];
    expect(encoded).toBeDefined();
    expect(Buffer.from(encoded.replace(/\n/g, ''), 'base64')).toEqual(
        Buffer.from(bytes),
    );
    expect(raw.length).toBeLessThan(400000);
});
it('preserves the pinned empty-attachment line layout', async () => {
    const module = await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/mail/parser.wasm',
                    import.meta.url,
                ),
            ),
        ),
        pure = new WasmDocumentParser(module);
    const stream = await streamMailDraftJSON(
        {
            from: { address: 'a@example.com' },
            to: [{ address: 'b@example.com' }],
            subject: 'S',
            text: 'Body',
        },
        [
            {
                file: { id: 'file', name: 'empty.txt', internal: true },
                kind: 'attachment',
            },
        ],
        { grant: { id: 'g' } } as never,
        {
            stat: async () => ({ size: 0 }),
            read: async () => new Response(new Uint8Array()),
        } as never,
        pure,
    );
    const json = JSON.parse(await new Response(stream).text()),
        raw = Buffer.from(json.raw, 'base64url').toString();
    expect(raw).toMatch(
        /filename="empty.txt"\nContent-Transfer-Encoding: base64\n\n\n--/,
    );
});

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { WasmDocumentParser } from '../src/infrastructure/documents/engine';
describe('exact pinned document parser', () => {
    it('repairs compatible XML and preserves exact mixed-script counting', async () => {
        const module = await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/docs/parser.wasm',
                    import.meta.url,
                ),
            ),
        );
        const parser = new WasmDocumentParser(module);
        const result = await parser.parse(
            '<p>Hello world</p><table><tr><td>A<td>B</table>',
        );
        expect(result.word_count).toBe(4);
        expect(result.blocks).toContainEqual(
            expect.objectContaining({ type: 'table', count: 1 }),
        );
        await expect(
            parser.parse('<!DOCTYPE a><p>x</p>'),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('shares safe initialization across concurrent calls', async () => {
        const module = await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/docs/parser.wasm',
                    import.meta.url,
                ),
            ),
        );
        const parser = new WasmDocumentParser(module);
        const values = await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
                parser.parse(`<p>${'word '.repeat(i + 1)}</p>`),
            ),
        );
        expect(values.map((x) => x.word_count)).toEqual([
            1, 2, 3, 4, 5, 6, 7, 8,
        ]);
    });
});

describe('shared exact interactive card formatter', () => {
    it('formats nested cards and preserves the invalid-card fallback', async () => {
        const module = await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/docs/parser.wasm',
                    import.meta.url,
                ),
            ),
        );
        const parser = new WasmDocumentParser(module);
        expect(await parser.format('{invalid', [])).toBe('[interactive card]');
        expect(
            await parser.format(
                JSON.stringify({
                    header: {
                        title: { tag: 'plain_text', content: 'Release' },
                    },
                    elements: [{ tag: 'markdown', content: 'Ready' }],
                }),
                [],
            ),
        ).toContain('Release');
        expect(
            await parser.format(
                JSON.stringify({
                    header: {
                        title: { tag: 'plain_text', content: 'Release' },
                    },
                    elements: [{ tag: 'markdown', content: 'Ready' }],
                }),
                [],
            ),
        ).toContain('Ready');
    });
});

describe('shared Base pure engine', () => {
    it('runs full jq and validates compilation errors', async () => {
        const module = await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/docs/parser.wasm',
                    import.meta.url,
                ),
            ),
        );
        const parser = new WasmDocumentParser(module);
        expect(
            await parser.process({
                operation: 'jq',
                expression: 'map(.score) | add',
                input: [{ score: 2 }, { score: 5 }],
            }),
        ).toEqual([7]);
        await expect(
            parser.process({ operation: 'jq-validate', expression: '.[' }),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

it('interrupts nonterminating jq inside the pure runtime', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const result = await promisify(execFile)(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `import {readFile} from 'node:fs/promises';import {Go} from './src/infrastructure/documents/generated/runtime.js';const go=new Go();const module=await WebAssembly.compile(await readFile('./src/infrastructure/documents/generated/docs/parser.wasm'));const instance=await WebAssembly.instantiate(module,go.importObject);void go.run(instance);const result=globalThis.cfLarkBaseRecords(JSON.stringify({operation:'jq',expression:'until(false; .+1)',input:0}));console.log(result);process.exit(0);`,
        ],
        { timeout: 7000 },
    );
    expect(JSON.parse(result.stdout)).toHaveProperty('error');
}, 10000);

it('exposes the pinned event card formatter', async () => {
    const module = await WebAssembly.compile(
        await readFile(
            new URL(
                '../src/infrastructure/documents/generated/docs/parser.wasm',
                import.meta.url,
            ),
        ),
    );
    const parser = new WasmDocumentParser(module);
    expect(typeof (await parser.formatEvent('{}', []))).toBe('string');
});

it('uses the exact upstream IM-Markdown converter', async () => {
    const module = await WebAssembly.compile(
        await readFile(
            new URL(
                '../src/infrastructure/documents/generated/docs/parser.wasm',
                import.meta.url,
            ),
        ),
    );
    const parser = new WasmDocumentParser(module);
    expect(
        await parser.toIMMarkdown(
            '<title>Title</title>\n<p><b>Bold</b></p>',
            'https://tenant.test/docx/d',
        ),
    ).toBe('# Title\n**Bold**');
});

it('rejects excessive XML markup complexity before initializing the native runtime', async () => {
    const parser = new WasmDocumentParser({} as WebAssembly.Module);
    await expect(parser.parse('<p/>'.repeat(32_769))).rejects.toMatchObject({
        code: 'RESOURCE_LIMIT',
        message: expect.stringContaining('32,768'),
    });
    await expect(
        parser.parse(`<p title="${'a'.repeat(2 * 1024 * 1024)}"/>`),
    ).rejects.toMatchObject({
        code: 'RESOURCE_LIMIT',
        message: expect.stringContaining('2 MiB'),
    });
});

it('counts malformed UTF-16 as UTF-8 replacement bytes for the markup budget', async () => {
    const parser = new WasmDocumentParser({} as WebAssembly.Module);
    await expect(
        parser.parse(`<p title="${'\ud800'.repeat(700_000)}"/>`),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
});

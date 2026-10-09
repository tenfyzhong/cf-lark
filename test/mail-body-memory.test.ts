import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
/** Opt-in characterization; this reports Wasm linear memory, not total Worker heap. */
describe.skipIf(process.env.CF_LARK_MAIL_BODY_MEMORY_PROBE !== '1')(
    'Mail body transformation memory envelope',
    () => {
        it('measures plain text and dense HTML without remote writes', async () => {
            const values = [];
            for (const [kind, size] of [
                ['plain', 1],
                ['plain', 4],
                ['plain', 8],
                ['html-text', 1],
                ['html-text', 4],
                ['html-text', 8],
                ['html-nodes', 0.125],
                ['html-nodes', 0.25],
                ['html-nodes', 0.5],
            ] as const) {
                const script = `import {readFile} from 'node:fs/promises';import {Go} from './src/infrastructure/documents/generated/runtime.js';const go=new Go();const module=await WebAssembly.compile(await readFile('./src/infrastructure/documents/generated/mail/parser.wasm'));const instance=await WebAssembly.instantiate(module,go.importObject);void go.run(instance);const size=${size}*1024*1024,kind=${JSON.stringify(kind)},body=kind==='html-nodes'?'<p>x</p>'.repeat(Math.floor(size/8)):kind==='html-text'?'<p>'+'x'.repeat(size)+'</p>':'x'.repeat(size);const input=kind==='plain'?{operation:'build-eml',from:{address:'a@example.com'},to:[{address:'b@example.com'}],subject:'Probe',text:body}:{operation:'lint',body};const start=performance.now();const output=JSON.parse(globalThis.cfLarkMail(JSON.stringify(input)));console.log(JSON.stringify({kind,sizeMiB:${size},memoryBytes:instance.exports.mem.buffer.byteLength,elapsedMs:performance.now()-start,error:output.error}));process.exit(0);`;
                const result = await promisify(execFile)(
                    process.execPath,
                    ['--input-type=module', '-e', script],
                    { timeout: 60000, maxBuffer: 100000 },
                );
                const value = JSON.parse(result.stdout);
                expect(value.error).toBeUndefined();
                values.push(value);
            }
            await (
                await import('node:fs/promises')
            ).writeFile(
                '/tmp/cf-lark-mail-body-memory.json',
                JSON.stringify(values, null, 2),
            );
        }, 300000);
    },
);

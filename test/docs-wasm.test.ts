import { describe, it, expect } from 'vitest';
import { buildDocsParserProbe } from '../scripts/wasm/docs-build';
describe.skipIf(process.env.CF_LARK_DOCS_WASM_PROBE !== '1')(
    'isolated pinned Docx parser',
    () => {
        it('builds below the Worker uncompressed limit and profiles exact XML', async () => {
            const result = await buildDocsParserProbe(
                '/tmp/cf-lark-upstream-1.0.97',
            );
            expect(result.bytes).toBeLessThan(64 * 1024 * 1024);
            expect(result.sample).toMatchObject({
                word_count: 2,
                block_count: 1,
            });
        }, 120000);
    },
);

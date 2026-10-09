import { describe, it, expect } from 'vitest';
import { patchMarkdown, diffMarkdown } from '../src/capabilities/markdown/transforms';
describe('Markdown content transforms', () => {
    it('replaces literal matches globally and preserves literal dollar characters', () => {
        expect(patchMarkdown('one one', 'one', '$1', false)).toEqual({ content: '$1 $1', count: 2 });
        expect(patchMarkdown('one', 'missing', '', false)).toEqual({ content: 'one', count: 0 });
    });
    it('uses RE2 syntax and Go replacement expansion including named and missing groups', () => {
        expect(patchMarkdown('abc123 xyz456', '(?P<word>[a-z]+)([0-9]+)', '${word}:$2:$$:$missing', true)).toEqual({ content: 'abc:123:$: xyz:456:$:', count: 2 });
        expect(() => patchMarkdown('aa', '(a)\\1', 'x', true)).toThrow();
        expect(patchMarkdown('ab', '(a)', '$1x', true).content).toBe('b');
    });
    it('emits unified line hunks and no-newline markers with exact counts', () => {
        const result = diffMarkdown('a/test', 'b/test', 'same\nold', 'same\nnew\n', 0);
        expect(result).toMatchObject({ changed: true, added_lines: 1, deleted_lines: 1, hunks: [{ old_start: 2, old_lines: 1, new_start: 2, new_lines: 1 }] });
        expect(result.diff).toBe('--- a/test\n+++ b/test\n@@ -2,1 +2,1 @@\n-old\n\\ No newline at end of file\n+new\n');
        expect(diffMarkdown('a', 'b', '', '', 3)).toMatchObject({ changed: false, diff: '', hunks: [] });
    });
});

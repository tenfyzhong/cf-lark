import { describe, it, expect } from 'vitest';
import { toIMMarkdown } from '../src/capabilities/docs/im-markdown';
describe('DocxXML to IM Markdown', () => {
    it('converts supported structure and retains unknown fragments', () => {
        expect(
            toIMMarkdown(
                '<title>Title</title>\n<p><b>Strong</b> <em>italic</em></p>\n<future>x</future>',
                'd',
            ),
        ).toBe('# Title\n**Strong** *italic*\n<future>x</future>');
        expect(toIMMarkdown('<p>truncated', 'd')).toBe('<p>truncated');
    });
    it('keeps nested list boundaries', () => {
        expect(
            toIMMarkdown(
                '<ol><li>A<ul><li>B</li></ul></li><li>C</li></ol>',
                'd',
            ),
        ).toBe('1. A- B\n2. C');
    });
    it('renders citations with tenant links and safe destinations', () => {
        expect(
            toIMMarkdown(
                '<cite type="user" user-id="u" user-name="Name"/> <sheet token="t" sheet-id="s"/> <a href="https://x/a (b)">Link</a>',
                'https://tenant.test/docx/d',
            ),
        ).toBe(
            '<at user_id="u">Name</at> [sheet s](https://tenant.test/sheets/t) [Link](https://x/a%20%28b%29)',
        );
    });
    it('uses safe code fences and table escaping', () => {
        expect(toIMMarkdown('<code>`x`</code>', 'd')).toBe('`` `x` ``');
        expect(
            toIMMarkdown(
                '<table><tr><td>A|B</td><td>C</td></tr><tr><td>D</td></tr></table>',
                'd',
            ),
        ).toBe('| A\\|B | C |\n| - | - |\n| D |  |');
    });
});

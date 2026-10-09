import { XMLValidator } from 'fast-xml-parser';
import { decodeXML } from 'entities';
import { ServiceError } from '../../domain/errors';
const fail = (message: string): never => {
    throw new ServiceError('INVALID_ARGUMENTS', message);
};
export function xmlTokens(content: string): Array<{
    text: string;
    offset: number;
    name: string;
    close: boolean;
    self: boolean;
}> {
    const tokens = [];
    const pattern =
        /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/gu;
    for (const match of content.matchAll(pattern)) {
        const text = match[0];
        if (/^<[!?]/u.test(text)) continue;
        tokens.push({
            text,
            offset: match.index,
            name: /^<\/?([^\s/>]+)/u.exec(text)![1]!,
            close: text.startsWith('</'),
            self: text.endsWith('/>'),
        });
    }
    return tokens;
}
export function validateXML(
    content: string,
    root?: string,
    prolog = true,
): void {
    if (
        !content.trim() ||
        content.length > 512 * 1024 ||
        /<!DOCTYPE|<!ENTITY/iu.test(content)
    )
        fail(
            'XML must be nonempty, at most 512 KiB, and cannot contain a DTD.',
        );
    if (!prolog && /<\?/u.test(content))
        fail('XML declarations are not supported when adding a slide.');
    if (XMLValidator.validate(content) !== true) fail('Malformed XML.');
    const tokens = xmlTokens(content);
    let depth = 0;
    let roots = 0;
    for (const t of tokens) {
        if (t.close) depth--;
        else {
            if (depth === 0) {
                roots++;
                if (root && t.name.split(':').at(-1) !== root)
                    fail(`Expected one <${root}> root.`);
            }
            if (!t.self) depth++;
        }
    }
    if (roots !== 1 || depth !== 0) fail('Expected one complete XML root.');
}
export function stampXML(content: string, id: string, whole = false): string {
    validateXML(content, whole ? 'slide' : undefined);
    const tokens = xmlTokens(content);
    const first = tokens[0]!;
    const attr = /\s+id\s*=\s*(?:"([^"]*)"|'([^']*)')/u.exec(first.text);
    if (whole && attr && decodeXML(attr[1] ?? attr[2] ?? '') !== id)
        fail('The slide root ID identifies a different page.');
    const escaped = id
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;');
    const root = attr
        ? first.text.replace(attr[0], ` id="${escaped}"`)
        : first.text.replace(/^<([^\s/>]+)/u, `<$1 id="${escaped}"`);
    const edits = [
        { offset: first.offset, length: first.text.length, text: root },
    ];
    let depth = 0;
    for (const token of tokens) {
        if (token.close) {
            depth--;
            continue;
        }
        if (whole && depth === 1 && token.name.split(':').at(-1) === 'note') {
            edits.push({
                offset: token.offset,
                length: token.text.length,
                text: token.text.replace(
                    /\s+id\s*=\s*(?:"[^"]*"|'[^']*')/gu,
                    '',
                ),
            });
        }
        if (!token.self) depth++;
    }
    for (const edit of edits.sort((a, b) => b.offset - a.offset))
        content =
            content.slice(0, edit.offset) +
            edit.text +
            content.slice(edit.offset + edit.length);
    return content;
}

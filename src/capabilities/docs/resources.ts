import { decodeXML } from 'entities';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
export interface DocumentResource extends JsonObject {
    kind: 'image' | 'file';
    marker: string;
    artifact?: string;
    url?: string;
    name?: string;
    presentation: JsonObject;
}
const fail = (message: string): never => {
    throw new ServiceError('INVALID_ARGUMENTS', message);
};
const obj = (value: unknown): JsonObject =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as JsonObject)
        : fail('Reference map must contain JSON objects.');
export const xmlEscape = (value: string) =>
    value.replace(
        /[&<>"']/gu,
        (c) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&apos;',
            })[c]!,
    );
function attrs(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    const body = raw.replace(/^<[^\s/>]+/u, '').replace(/\/?\s*>$/u, '');
    let end = 0;
    for (const m of body.matchAll(/([^\s=]+)\s*=\s*("[^"]*"|'[^']*')/gu)) {
        if (body.slice(end, m.index).trim())
            fail('Malformed resource attributes.');
        if (m[1]! in result) fail('Duplicate resource attribute.');
        result[m[1]!] = decodeXML(m[2]!.slice(1, -1));
        end = m.index! + m[0].length;
    }
    if (body.slice(end).trim()) fail('Malformed resource attributes.');
    return result;
}
function tag(name: string, a: Record<string, string>, body?: string) {
    const fields = Object.entries(a)
        .map(([k, v]) => ` ${k}="${xmlEscape(v)}"`)
        .join('');
    return body === undefined
        ? `<${name}${fields}/>`
        : `<${name}${fields}>${body}</${name}>`;
}
function artifact(value: string): string {
    if (
        !value.startsWith('@') ||
        value.length < 2 ||
        /^@lcli_(?:img|file)_/u.test(value)
    )
        fail('Local resource paths must use a private @artifact handle.');
    return value.slice(1);
}
function protectMarkdown(content: string): {
    text: string;
    restore: (text: string) => string;
} {
    const spans: string[] = [];
    const stash = (x: string) => {
        const i = spans.push(x) - 1;
        return `\u0001${i}\u0002`;
    };
    let fence = '';
    let run = 0;
    const lines = content.split(/(?<=\n)/u).map((line) => {
        const m = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
        if (fence) {
            const out = stash(line);
            if (m && m[1]![0] === fence && m[1]!.length >= run) {
                fence = '';
                run = 0;
            }
            return out;
        }
        if (m) {
            fence = m[1]![0]!;
            run = m[1]!.length;
            return stash(line);
        }
        if (/^(?: {4}|\t)/u.test(line)) return stash(line);
        return line
            .replace(/(`+)([\s\S]*?)\1/gu, stash)
            .replace(/\\[\\`*{}\[\]()#+.!<>_-]/gu, stash);
    });
    return {
        text: lines.join(''),
        restore: (text) =>
            text.replace(/\u0001(\d+)\u0002/gu, (_, i) => spans[Number(i)]!),
    };
}
/** Recognizes balanced inline image labels and destinations without touching malformed markup. */
function rewriteMarkdownImages(text: string): string {
    let output = '';
    let start = 0;
    for (let i = 0; i < text.length - 1; i++) {
        if (text.slice(i, i + 2) !== '![') continue;
        let cursor = i + 2;
        let depth = 1;
        for (; cursor < text.length && depth; cursor++) {
            if (text[cursor] === '[') depth++;
            if (text[cursor] === ']') depth--;
        }
        if (depth || text[cursor] !== '(') continue;
        const label = text.slice(i + 2, cursor - 1);
        cursor++;
        while (/\s/u.test(text[cursor] ?? '') && cursor < text.length) cursor++;
        let destination = '';
        if (text[cursor] === '<') {
            const end = text.indexOf('>', cursor + 1);
            if (end < 0) continue;
            destination = text.slice(cursor + 1, end);
            cursor = end + 1;
        } else {
            const begin = cursor;
            let parens = 0;
            for (; cursor < text.length; cursor++) {
                const char = text[cursor]!;
                if (char === '(') parens++;
                else if (char === ')') {
                    if (!parens) break;
                    parens--;
                }
                if (/\s/u.test(char) && !parens) break;
            }
            if (parens) continue;
            destination = text.slice(begin, cursor);
        }
        if (!destination.startsWith('@')) continue;
        const separator = cursor;
        while (cursor < text.length && /\s/u.test(text[cursor]!)) cursor++;
        let title: string | undefined;
        if (
            cursor > separator &&
            ['"', "'", '('].includes(text[cursor] ?? '')
        ) {
            const close = text[cursor] === '(' ? ')' : text[cursor]!;
            const end = text.indexOf(close, cursor + 1);
            if (end < 0) continue;
            title = text.slice(cursor + 1, end);
            cursor = end + 1;
            while (cursor < text.length && /\s/u.test(text[cursor]!)) cursor++;
        }
        if (text[cursor] !== ')') continue;
        output +=
            text.slice(start, i) +
            tag('img', {
                path: destination,
                caption: label,
                ...(title !== undefined ? { title } : {}),
            });
        start = cursor + 1;
        i = cursor;
    }
    return output + text.slice(start);
}
/** Prepares pure authoring markup; supplied reads enforce the caller's artifact grant. */
export async function prepareDocumentResources(
    content: string,
    format: string,
    reference: JsonObject,
    read: (id: string) => Promise<string>,
): Promise<{
    content: string;
    referenceMap: JsonObject;
    resources: DocumentResource[];
}> {
    const referenceMap = structuredClone(reference);
    const resources: DocumentResource[] = [];
    const protectedText =
        format === 'markdown'
            ? protectMarkdown(content)
            : { text: content, restore: (x: string) => x };
    const inert: string[] = [];
    const hide = (value: string) => `\u0003${inert.push(value) - 1}\u0004`;
    let text = protectedText.text.replace(
        /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/gu,
        hide,
    );
    if (format === 'markdown') {
        text = text.replace(
            /<(pre|code|script|style|textarea)\b[^>]*>[\s\S]*?<\/\1>/giu,
            hide,
        );
        const normalize = (v: string) =>
            v.trim().replace(/\s+/gu, ' ').toLowerCase();
        const refs = new Set(
            [...text.matchAll(/^ {0,3}\[([^\]]+)\]:\s*<?(@[^\s>]+)/gmu)].map(
                (m) => normalize(m[1]!),
            ),
        );
        for (const match of text.matchAll(/!\[([^\]]*)\](?:\[([^\]]*)\])?/gu)) {
            if (refs.has(normalize(match[2] || match[1]!)))
                fail(
                    'Local Markdown reference-style images are unsupported; use ![alt](@artifact).',
                );
        }
    }
    if (format === 'markdown') text = rewriteMarkdownImages(text);
    const pattern =
        /<(html5-block|whiteboard|img|source)\b(?:"[^"]*"|'[^']*'|[^'">])*\/?>(?:[\s\S]*?<\/\1>)?/gu;
    let out = '';
    let last = 0;
    let refIndex = 1;
    for (const m of text.matchAll(pattern)) {
        out += text.slice(last, m.index);
        last = m.index! + m[0].length;
        const name = m[1]!;
        const start = /^<(?:"[^"]*"|'[^']*'|[^'">])*>/u.exec(m[0])![0];
        const a = attrs(start);
        const body = m[0]
            .slice(start.length)
            .replace(new RegExp(`</${name}>$`, 'u'), '');
        let replacement = m[0];
        if (name === 'html5-block') {
            if ('data' in a)
                fail('html5-block data is reserved; use path or data-ref.');
            if (body.trim())
                fail('html5-block must not contain an inline body.');
            if (a.path && a['data-ref'])
                fail('html5-block cannot combine path and data-ref.');
            const group =
                referenceMap['html5-block'] === undefined
                    ? {}
                    : obj(referenceMap['html5-block']);
            referenceMap['html5-block'] = group;
            if (a.path) {
                while (`html5_${refIndex}` in group) refIndex++;
                const key = `html5_${refIndex++}`;
                group[key] = { data: await read(artifact(a.path)) };
                delete a.path;
                a['data-ref'] = key;
            } else if (!a['data-ref'] || !group[a['data-ref']])
                fail('html5-block data-ref requires a reference map entry.');
            replacement = tag(name, a);
        } else if (
            name === 'whiteboard' &&
            (a.path || body.trim().startsWith('@'))
        ) {
            if (a.path && body.trim())
                fail('whiteboard cannot combine path and inline content.');
            const type = a.type?.toLowerCase() ?? '';
            if (!['svg', 'mermaid', 'plantuml'].includes(type))
                fail(
                    'Whiteboard artifact input requires svg, mermaid or plantuml.',
                );
            const value = await read(artifact(a.path || body.trim()));
            delete a.path;
            a.type = type;
            replacement = tag(
                name,
                a,
                type === 'svg' ? value : xmlEscape(value),
            );
        } else if (
            (name === 'img' || name === 'source') &&
            (a.path || (name === 'img' && a.href))
        ) {
            const source = (a.path || a.href)!;
            for (const conflict of [
                'src',
                'token',
                'img_key',
                'img-key',
                'url',
                ...(a.path ? ['href'] : []),
            ])
                if (conflict in a)
                    fail(`Resource input conflicts with ${conflict}.`);
            const kind = name === 'img' ? 'image' : 'file';
            const marker = `@lcli_${kind === 'image' ? 'img' : 'file'}_${crypto.randomUUID().replaceAll('-', '')}`;
            const presentation: JsonObject = {};
            for (const key of ['width', 'height', 'align', 'scale'])
                if (a[key]) presentation[key] = a[key];
            const resource: DocumentResource = { kind, marker, presentation };
            if (a.path) resource.artifact = artifact(source);
            else {
                let url: URL;
                try {
                    url = new URL(source);
                } catch {
                    fail('Image href must be an absolute HTTPS URL.');
                }
                if (url!.username || url!.password)
                    fail('Remote image URLs cannot contain userinfo.');
                if (url!.protocol !== 'https:')
                    fail('Image href must be HTTPS.');
                resource.url = source;
            }
            if (name === 'source' && 'name' in a) {
                if (
                    !a.name.trim() ||
                    ['.', '..'].includes(a.name.trim()) ||
                    /[\\/]/u.test(a.name)
                )
                    fail(
                        'Source name must be a file name without path separators.',
                    );
                resource.name = a.name.trim();
            }
            if (name === 'img' && a.alt && !a.caption) {
                a.caption = a.alt;
                delete a.alt;
            }
            delete a.href;
            a.path = marker;
            resources.push(resource);
            replacement = tag(name, a);
        }
        out += replacement;
    }
    out += text.slice(last);
    const html = referenceMap['html5-block'];
    if (html !== undefined)
        for (const [key, entry] of Object.entries(obj(html))) {
            const value = obj(entry);
            if (value.path !== undefined) {
                if (value.data !== undefined)
                    fail('HTML5 reference cannot combine data and path.');
                value.data = await read(artifact(String(value.path)));
                delete value.path;
            }
            if (typeof value.data !== 'string')
                fail(`HTML5 reference ${key} requires string data.`);
        }
    return {
        content: protectedText.restore(
            out.replace(/\u0003(\d+)\u0004/gu, (_, i) => inert[Number(i)]!),
        ),
        referenceMap,
        resources,
    };
}

export async function exportDocumentResources(
    data: JsonObject,
    format: string,
    save: (html: string) => Promise<string>,
): Promise<void> {
    const document = data.document;
    if (!document || typeof document !== 'object' || Array.isArray(document))
        return;
    const doc = document as JsonObject;
    const content = String(doc.content ?? '');
    const source =
        format === 'markdown' ? protectMarkdown(content).text : content;
    const tags = [
        ...source.matchAll(/<html5-block\b(?:"[^"]*"|'[^']*'|[^'">])*>/gu),
    ];
    if (!tags.length) return;
    const reference = obj(doc.reference_map);
    const group = obj(reference['html5-block']);
    for (const match of tags) {
        const a = attrs(match[0]);
        const ref = a['data-ref']?.trim();
        if (!ref || !group[ref])
            fail('Fetched HTML5 block has no matching reference-map entry.');
    }
    for (const [ref, raw] of Object.entries(group)) {
        const entry = obj(raw);
        if (
            typeof entry.data !== 'string' ||
            new TextEncoder().encode(entry.data).byteLength <= 1024
        )
            continue;
        if (!/^[A-Za-z0-9._-]+$/u.test(ref) || ['.', '..'].includes(ref))
            fail('Invalid HTML5 reference name.');
        entry.path = '@' + (await save(entry.data));
        delete entry.data;
    }
}

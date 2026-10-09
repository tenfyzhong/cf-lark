import { decodeHTML, escapeText } from 'entities';
import { ServiceError } from '../../domain/errors';
const known = new Set(
    'title h1 h2 h3 h4 h5 h6 h7 h8 h9 p ul ol li callout blockquote grid column table colgroup col pre code latex hr img figure source button time whiteboard sheet task chat_card bitable base_refer okr poll agenda folder_manager wiki_catalog wiki_recent_update chart_refer_host_perm synced_reference synced-source mindnote bookmark cite b em del u span a'.split(
        ' ',
    ),
);
const discard = new Set(
    'colgroup col figure button time poll agenda folder_manager wiki_catalog wiki_recent_update chart_refer_host_perm synced_reference synced-source mindnote'.split(
        ' ',
    ),
);
const first = (...v: (string | undefined)[]) =>
    v.find((x) => x?.trim())?.trim() ?? '';
const plain = (s: string) =>
    decodeHTML(
        s.replace(/<br\s*\/?>/giu, '\n').replace(/<\/?[A-Za-z][^>]*>/gu, ''),
    ).trim();
const label = (s: string) =>
    plain(s)
        .split('\n')
        .filter((l) => l.trim() !== '---')
        .join('\n')
        .trim();
const inline = (s: string) => {
    const n =
        Math.max(0, ...[...s.matchAll(/`+/gu)].map((m) => m[0].length)) + 1;
    const fence = '`'.repeat(n);
    return fence + (/^`|`$/u.test(s) ? ` ${s} ` : s) + fence;
};
const destination = (s: string) =>
    s.replace(/%(?![a-fA-F\d]{2})|[\x00-\x20\x7f-\uffff()<>"\\^`{|}]/gu, (c) =>
        [...new TextEncoder().encode(c)]
            .map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`)
            .join(''),
    );
const link = (text: string, url: string) =>
    `[${first(text, url).replace(/[\\[\]]/gu, '\\$&')}](${destination(url.trim())})`;
function attributes(open: string): Record<string, string> {
    return Object.fromEntries(
        [
            ...open.matchAll(
                /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu,
            ),
        ].map((m) => [m[1]!.toLowerCase(), decodeHTML(m[2] ?? m[3] ?? '')]),
    );
}
interface Element {
    tag: string;
    open: string;
    inner: string;
    segment: string;
    start: number;
    end: number;
}
function elements(source: string, tags?: Set<string>): Element[] {
    const pattern = /<([A-Za-z][\w:-]*)(?:\s[^<>]*?)?\s*\/?>/gu;
    const out: Element[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
        const tag = match[1]!.toLowerCase();
        if (tags && !tags.has(tag)) continue;
        const open = match[0];
        const start = match.index;
        const from = pattern.lastIndex;
        if (open.endsWith('/>')) {
            out.push({ tag, open, inner: '', segment: open, start, end: from });
            continue;
        }
        const close = new RegExp(`<(/?)${tag}(?:\\s[^<>]*?)?\\s*/?>`, 'giu');
        close.lastIndex = from;
        let depth = 1;
        let end: RegExpExecArray | null;
        while ((end = close.exec(source))) {
            if (end[1]) depth--;
            else if (!end[0].endsWith('/>')) depth++;
            if (depth === 0) {
                out.push({
                    tag,
                    open,
                    inner: source.slice(from, end.index),
                    segment: source.slice(start, close.lastIndex),
                    start,
                    end: close.lastIndex,
                });
                pattern.lastIndex = close.lastIndex;
                break;
            }
        }
        if (depth !== 0) break;
    }
    return out;
}
export function toIMMarkdown(source: string, doc: string): string {
    let base = 'https://larkoffice.com';
    try {
        base = new URL(doc).origin;
    } catch {
        /* Bare tokens use the canonical public host. */
    }
    return convert(source, base, 0, false);
}
function convert(
    source: string,
    base: string,
    depth: number,
    quote: boolean,
): string {
    if (depth > 128)
        throw new ServiceError(
            'INVALID_UPSTREAM_RESPONSE',
            'Document XML nesting exceeds the conversion limit.',
            502,
        );
    let result = '';
    let offset = 0;
    for (const el of elements(source, known)) {
        result += source.slice(offset, el.start);
        const a = attributes(el.open);
        const recurse = (s: string, q = quote) =>
            convert(s, base, depth + 1, q);
        const body = () => recurse(el.inner).trim();
        let value = '';
        if (discard.has(el.tag)) value = '';
        else if (el.tag === 'title' || /^h[1-9]$/u.test(el.tag))
            value = body()
                ? `${'#'.repeat(el.tag === 'title' ? 1 : Math.min(6, Number(el.tag.slice(1))))} ${body()}`
                : '';
        else if (['p', 'grid', 'column', 'u', 'span'].includes(el.tag))
            value =
                body() +
                (body() && (el.tag === 'column' || (el.tag === 'p' && quote))
                    ? '\n'
                    : '');
        else if (el.tag === 'b' || el.tag === 'em' || el.tag === 'del') {
            const mark = el.tag === 'b' ? '**' : el.tag === 'em' ? '*' : '~~';
            value = body() ? mark + body() + mark : '';
        } else if (el.tag === 'blockquote')
            value = recurse(el.inner, true)
                .trim()
                .split('\n')
                .map((l) => (l.trim() ? `> ${l}` : '>'))
                .join('\n');
        else if (el.tag === 'callout') {
            const text = first(a.emoji)
                ? first(a.emoji) + (body() ? ` ${body()}` : '')
                : body();
            value = text ? `---\n${text}\n---` : '---\n---';
        } else if (el.tag === 'ul' || el.tag === 'ol') {
            value = elements(el.inner, new Set(['li']))
                .map((item, index) => {
                    const attrs = attributes(item.open);
                    const prefix =
                        el.tag === 'ul'
                            ? '-'
                            : attrs.seq && attrs.seq !== 'auto'
                              ? `${attrs.seq.replace(/\.$/u, '')}.`
                              : `${index + 1}.`;
                    const text = recurse(item.inner).trim();
                    return text
                        ? `${prefix} ${text.replaceAll('\n', '\n  ')}`
                        : '';
                })
                .filter(Boolean)
                .join('\n');
        } else if (el.tag === 'li')
            value = body()
                ? `${a.seq && a.seq !== 'auto' ? `${a.seq.replace(/\.$/u, '')}.` : '-'} ${body().replaceAll('\n', '\n  ')}\n`
                : '';
        else if (el.tag === 'pre') {
            const code = decodeHTML(
                el.inner
                    .trim()
                    .replace(/^<code(?:\s[^<>]*?)?>([\s\S]*)<\/code>$/iu, '$1'),
            );
            const fence = '`'.repeat(
                Math.max(
                    3,
                    ...code
                        .split('\n')
                        .map((l) => (/^`*/u.exec(l)?.[0].length ?? 0) + 1),
                ),
            );
            value =
                fence +
                first(a.lang) +
                '\n' +
                code.replace(/^\n+|\n+$/gu, '') +
                '\n' +
                fence;
        } else if (el.tag === 'code') value = inline(plain(el.inner));
        else if (el.tag === 'latex')
            value = plain(el.inner)
                ? `$${plain(el.inner).replaceAll('$', '\\$')}$`
                : '';
        else if (el.tag === 'hr') value = '---';
        else if (el.tag === 'img') {
            const url = first(a.href, a.src, a.url);
            value = url ? '!' + link(first(a.alt, a.name, a.title), url) : '';
            if (url && !first(a.alt, a.name, a.title))
                value = `![](${destination(url)})`;
        } else if (el.tag === 'source')
            value = a.name ? inline(a.name.trim()) : '';
        else if (el.tag === 'whiteboard') value = inline(el.segment);
        else if (el.tag === 'sheet')
            value = a.token
                ? link(
                      a['sheet-id'] ? `sheet ${a['sheet-id']}` : 'sheet',
                      `${base}/sheets/${a.token}`,
                  )
                : inline(el.segment);
        else if (['bitable', 'base_refer', 'okr'].includes(el.tag))
            value = inline(el.tag === 'okr' ? 'OKR' : 'Base');
        else if (el.tag === 'task')
            value = first(a['task-id'], a.guid, a.token, a.id)
                ? inline('Task')
                : '';
        else if (el.tag === 'chat_card')
            value = first(a['chat-id'], a.chat_id, a.id)
                ? inline('Chat card')
                : '';
        else if (el.tag === 'a' || el.tag === 'bookmark') {
            const text =
                el.tag === 'a'
                    ? first(label(body()), a.name, a.title, a.href)
                    : first(a.name, a.title, label(body()), a.href);
            value = a.href ? link(text, a.href) : text;
        } else if (el.tag === 'cite') {
            switch (a.type?.trim().toLowerCase()) {
                case 'user': {
                    const id = first(a['user-id'], a['open-id'], a.id);
                    const name = first(
                        a['user-name'],
                        a.name,
                        plain(el.inner),
                        id,
                    );
                    value = id
                        ? `<at user_id="${escapeText(id).replaceAll('"', '&quot;')}">${escapeText(name)}</at>`
                        : name;
                    break;
                }
                case 'doc': {
                    const title = first(
                        a.title,
                        a.name,
                        a['doc-id'],
                        'document',
                    );
                    const token = first(a['doc-id'], a.token);
                    const url = first(a.href, a.url);
                    value = url
                        ? link(title, url)
                        : token
                          ? link(
                                title,
                                `${base}/${first(a['file-type'], 'docx')
                                    .toLowerCase()
                                    .replace(/^\/+|\/+$/gu, '')}/${token}`,
                            )
                          : inline(el.segment);
                    break;
                }
                case 'citation': {
                    const anchor = elements(el.inner, new Set(['a']))[0];
                    const href = anchor ? attributes(anchor.open).href : '';
                    value = href
                        ? link(first(plain(anchor!.inner), href), href)
                        : first(a.href, a.url)
                          ? link(
                                first(a.title, a.name, a.href, a.url),
                                first(a.href, a.url),
                            )
                          : plain(body());
                    break;
                }
                default:
                    value = inline(el.segment);
            }
        } else if (el.tag === 'table') {
            const rows = elements(el.inner, new Set(['tr']))
                .map((row) =>
                    elements(row.inner, new Set(['td', 'th'])).map((cell) =>
                        decodeHTML(
                            recurse(cell.inner).replace(
                                /<\/?(?!at\b)[A-Za-z][^>]*>/giu,
                                (m) => (/^<br/iu.test(m) ? '<br>' : ''),
                            ),
                        )
                            .replace(/  \n|\n/gu, '<br>')
                            .replaceAll('|', '\\|')
                            .trim()
                            .replace(/\s+/gu, ' '),
                    ),
                )
                .filter((row) => row.length);
            if (!rows.length) value = inline(el.segment);
            else {
                const cols = Math.max(...rows.map((r) => r.length));
                const row = (r: string[]) =>
                    '| ' +
                    [...r, ...Array<string>(cols - r.length).fill('')].join(
                        ' | ',
                    ) +
                    ' |';
                value = [
                    row(rows[0]!),
                    row(Array<string>(cols).fill('-')),
                    ...rows.slice(1).map(row),
                ].join('\n');
            }
        }
        result += value;
        offset = el.end;
    }
    return result + source.slice(offset);
}

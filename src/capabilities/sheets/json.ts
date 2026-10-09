import { ServiceError } from '../../domain/errors';
/** Strict parsing first; fallback rewrites only unambiguous lexical spellings. */
export type SheetJSONReviver = (this: any, key: string, value: any, context?: { source?: string }) => any;
export function parseSheetJSON(value: unknown, reviver?: SheetJSONReviver): any {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value, reviver); } catch { /* Try the pinned lexical repair contract. */ }
    const invalid = (): never => { throw new ServiceError('INVALID_ARGUMENTS', 'Invalid JSON; truncated or ambiguous input cannot be repaired.'); };
    let output = '';
    for (let i = 0; i < value.length;) {
        const char = value[i]!;
        if (char === '"' || char === "'") {
            const quote = char, start = i++; let decoded = '', closed = false;
            for (; i < value.length; i++) {
                const current = value[i]!;
                if (current === quote) { i++; closed = true; break; }
                if (current !== '\\') { decoded += current; continue; }
                const escaped = value[++i]; if (escaped === undefined) invalid();
                if (quote === '"') continue;
                const escapes: Record<string, string> = { "'": "'", '"': '"', '\\': '\\', '/': '/', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
                if (!Object.hasOwn(escapes, escaped!)) invalid(); decoded += escapes[escaped!]!;
            }
            if (!closed) invalid();
            output += quote === '"' ? value.slice(start, i) : JSON.stringify(decoded); continue;
        }
        if (char === ']' || char === '}') { output = output.replace(/,[ \t\r\n]*$/, ''); output += char; i++; continue; }
        if (/[{\[,:\s]/u.test(char)) { output += char; i++; continue; }
        const start = i;
        while (i < value.length && !/[,\[\]{}:"']/.test(value[i]!)) i++;
        const token = value.slice(start, i).trimEnd(); if (!token) invalid();
        const literals: Record<string, string> = { True: 'true', False: 'false', None: 'null', undefined: 'null', nan: 'null', NaN: 'null' };
        if (Object.hasOwn(literals, token)) output += literals[token];
        else if (['true', 'false', 'null'].includes(token) || (/^[0-9.eE-]+$/.test(token) && Number.isFinite(Number(token)))) output += token;
        else { if (/^[0-9+.-]/.test(token) || /["'\\]/.test(token)) invalid(); output += JSON.stringify(token); }
    }
    try { return JSON.parse(output, reviver); } catch { return invalid(); }
}

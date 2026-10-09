import { RE2JS } from 're2js';
import DiffMatchPatch from 'diff-match-patch';
import { ServiceError } from '../../domain/errors';
export function compilePattern(pattern: string) {
    try { return RE2JS.compile(pattern); }
    catch { throw new ServiceError('INVALID_ARGUMENTS', 'pattern is not a valid RE2 regular expression.'); }
}
export function patchMarkdown(original: string, pattern: string, replacement: string, regex: boolean) {
    if (!pattern) throw new ServiceError('INVALID_ARGUMENTS', 'pattern must not be empty.');
    if (!regex) { const parts = original.split(pattern); return { content: parts.join(replacement), count: parts.length - 1 }; }
    const compiled = compilePattern(pattern), matcher = compiled.matcher(original), groups = compiled.namedGroups();
    let result = '', cursor = 0, count = 0, previousEnd = -1;
    while (matcher.find()) {
        const start = matcher.start(), end = matcher.end();
        if (start === end && start === previousEnd) continue;
        result += original.slice(cursor, start);
        result += replacement.replace(/\$\$|\$\{([A-Za-z0-9_]+)\}|\$([A-Za-z0-9_]+)/g, (raw, braced: string | undefined, bare: string | undefined) => {
            if (raw === '$$') return '$';
            const key = braced ?? bare ?? '', index = /^\d+$/.test(key) && (key === '0' || !key.startsWith('0')) ? Number(key) : groups[key];
            return index !== undefined && index <= matcher.groupCount() ? matcher.group(index) ?? '' : '';
        });
        cursor = end; previousEnd = end; count++;
    }
    return { content: result + original.slice(cursor), count };
}
export function diffMarkdown(fromLabel: string, toLabel: string, original: string, updated: string, context: number) {
    const engine = new DiffMatchPatch(); engine.Diff_Timeout = 30;
    const encoded = engine.diff_linesToChars_(original, updated), diffs = engine.diff_main(encoded.chars1, encoded.chars2, false);
    engine.diff_charsToLines_(diffs, encoded.lineArray);
    const operations = diffs.flatMap(([kind, content]) => (content.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((line) => ({ kind, line })));
    const changes = operations.flatMap((operation, index) => operation.kind ? [index] : []), ranges: { start: number; end: number }[] = [];
    for (const index of changes) {
        const next = { start: Math.max(0, index - context), end: Math.min(operations.length, index + context + 1) }, previous = ranges.at(-1);
        if (previous && next.start <= previous.end) previous.end = Math.max(previous.end, next.end);
        else ranges.push(next);
    }
    const hunks = ranges.map((range) => {
        const prefix = operations.slice(0, range.start), lines = operations.slice(range.start, range.end);
        const oldBefore = prefix.filter((item) => item.kind !== 1).length, newBefore = prefix.filter((item) => item.kind !== -1).length;
        const oldLines = lines.filter((item) => item.kind !== 1).length, newLines = lines.filter((item) => item.kind !== -1).length;
        const oldStart = oldBefore + (oldLines ? 1 : 0), newStart = newBefore + (newLines ? 1 : 0);
        return { header: `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`, old_start: oldStart, old_lines: oldLines, new_start: newStart, new_lines: newLines };
    });
    let diff = changes.length ? `--- ${fromLabel}\n+++ ${toLabel}\n` : '';
    ranges.forEach((range, index) => {
        diff += `${hunks[index]!.header}\n`;
        for (const operation of operations.slice(range.start, range.end)) diff += `${operation.kind === -1 ? '-' : operation.kind === 1 ? '+' : ' '}${operation.line}${operation.line.endsWith('\n') ? '' : '\n\\ No newline at end of file\n'}`;
    });
    return { changed: changes.length > 0, added_lines: operations.filter((item) => item.kind === 1).length, deleted_lines: operations.filter((item) => item.kind === -1).length, hunks, diff };
}

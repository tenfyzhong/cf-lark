import { validateSheetFlag } from './validate';
import { parseSheetJSON } from './json';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
export function jsonArray(value: unknown): unknown[] {
    if (typeof value === 'string') { try { value = parseSheetJSON(value); } catch { invalid('Expected valid JSON.'); } }
    if (!Array.isArray(value)) invalid('Expected a JSON array.');
    return value;
}
export function rangeAreas(raw: string): string[] {
    const result: string[] = []; let quoted = false, start = 0;
    for (let index = 0; index <= raw.length; index++) {
        if (raw[index] === "'") quoted = !quoted;
        if (index === raw.length || raw[index] === ',' && !quoted) { const area = raw.slice(start, index).trim(); if (area) result.push(area); start = index + 1; }
    }
    return result.length ? result : [raw.trim()];
}
export function splitRange(raw: string): { sheet?: string; range: string } {
    const value = raw.trim();
    const match = value.startsWith("'") ? /^'((?:[^']|'')*)'\s*\\?[!\uFF01]\s*(.+)$/s.exec(value) : /^([^!\uFF01]+?)(?:\\)?[!\uFF01]\s*(.+)$/s.exec(value);
    if (!match || !match[1]!.trim() || !match[2]!.trim()) return { range: value };
    return { sheet: (value.startsWith("'") ? match[1]!.replaceAll("''", "'") : match[1]!).trim(), range: match[2]!.trim() };
}
export function dimensions(raw: string): { rows: number; cols: number } {
    const range = splitRange(raw).range.replaceAll('$', '');
    const match = /^([a-z]+)([1-9][0-9]*)(?::([a-z]+)([1-9][0-9]*))?$/i.exec(range);
    if (!match) invalid('A bounded A1 cell range is required.');
    const col = (s: string) => [...s.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    const rows = Number(match[4] ?? match[2]) - Number(match[2]) + 1, cols = col(match[3] ?? match[1]!) - col(match[1]!) + 1;
    if (rows <= 0 || cols <= 0 || !Number.isSafeInteger(rows * cols)) invalid('Invalid ordered A1 range.');
    return { rows, cols };
}
export function matrix(range: string, cell: JsonObject, budget: { total: number }): JsonObject[][] {
    const { rows, cols } = dimensions(range);
    budget.total += rows * cols;
    if (budget.total > 200000) invalid('The request exceeds the 200000-cell matrix safety cap.');
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => cell));
}
export function dropdownValidation(args: JsonObject): JsonObject {
    const source = typeof args['source-range'] === 'string' ? args['source-range'].trim() : '';
    if (Boolean(source) === (args.options !== undefined)) invalid('Provide exactly one options or source-range.');
    let size: number, value: JsonObject;
    if (source) { const dim = dimensions(source); size = dim.rows * dim.cols; value = { type: 'listFromRange', range: source }; }
    else { const options = jsonArray(args.options); validateSheetFlag('dropdown-set', 'options', options); if (options.some(v => typeof v !== 'string')) invalid('Dropdown options must be strings.'); size = options.length; value = { type: 'list', items: options }; }
    if (args.colors !== undefined) {
        const colors = jsonArray(args.colors);
        if (colors.length > size || colors.some(v => typeof v !== 'string')) invalid('Colors must be strings and cannot exceed the source size.');
        value.highlight_colors = colors;
    }
    if (args.multiple === true) value.support_multiple_values = true;
    if (Object.hasOwn(args, 'highlight')) value.enable_highlight = args.highlight;
    return value;
}
export function dropdownInput(name: string, args: JsonObject, value: JsonObject): void {
    const cell: JsonObject = { data_validation: name === 'dropdown-delete' ? null : dropdownValidation(args) };
    const budget = { total: 0 };
    if (name === 'dropdown-set') {
        if (typeof args.range !== 'string') invalid('range is required.');
        value.range = args.range.trim(); value.cells = matrix(value.range as string, cell, budget);
    } else {
        const ranges = jsonArray(args.ranges);
        if (ranges.length > 100 || ranges.some(v => typeof v !== 'string')) invalid('Provide at most 100 sheet-prefixed ranges.');
        value.operations = ranges.map(raw => {
            const ref = splitRange(raw as string);
            if (!ref.sheet) invalid('Each range requires a sheet prefix.');
            return { tool_name: 'set_cell_range', input: { excel_id: value.excel_id, sheet_name: ref.sheet, range: ref.range, cells: matrix(ref.range, cell, budget) } };
        });
    }
}

import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
import { stylesPlan } from './declarative-styles';
import { splitRange } from './matrices';
import { parseSheetJSON } from './json';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
const parse = parseSheetJSON;
class ExactNumber { constructor(readonly lexeme: string) {} }
function numericLexeme(raw: string): number | ExactNumber { return String(Number(raw)) === raw ? Number(raw) : new ExactNumber(raw); }
function parseTable(value: unknown, rootCells = false): any {
    if (typeof value !== 'string') return value;
    const parsed = parseSheetJSON(value, function (_key, item, context) {
        if (typeof item !== 'number') return item;
        if (context?.source === undefined) invalid('The runtime must support exact JSON numeric source decoding.');
        return numericLexeme(context.source);
    });
    function restore(item: any, cells: boolean): any {
        if (item instanceof ExactNumber) return cells ? item : Number(item.lexeme);
        if (Array.isArray(item)) return item.map(value => restore(value, cells));
        if (isObject(item)) return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, restore(value, cells || key === 'data')]));
        return item;
    }
    return restore(parsed, rootCells);
}
export function serializeTableInput(value: unknown): string {
    if (value instanceof ExactNumber) return value.lexeme;
    if (Array.isArray(value)) return `[${value.map(item => item === undefined ? 'null' : serializeTableInput(item)).join(',')}]`;
    if (isObject(value)) return `{${Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => `${JSON.stringify(key)}:${serializeTableInput(item)}`).join(',')}}`;
    return JSON.stringify(value);
}
export function letter(n: number): string { let out = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out; return out; }
export function anchor(value: unknown): { col: number; row: number } {
    const m = /^\$?([A-Z]+)\$?([1-9][0-9]*)$/i.exec(String(value || 'A1'));
    if (!m) invalid('start_cell must be a single A1 cell.');
    return { col: [...m[1]!.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0), row: Number(m[2]) };
}
export interface TableSheet { name: string; columns: string[]; data: unknown[][]; types: string[]; formats: string[]; mode: string; header?: boolean; allowOverwrite?: boolean; start: { col: number; row: number }; styleOperations: JsonObject[] }
export function typedCell(raw: unknown, type: string, format: string): JsonObject {
    format = format.trim() || (type === 'date' ? 'yyyy-mm-dd' : type === 'string' ? '@' : '');
    const cell: JsonObject = format ? { cell_styles: { number_format: format } } : {};
    if (raw === null || raw === undefined) return cell;
    if (type === 'number') {
        if (typeof raw === 'string' && !raw.trim()) return cell;
        if (!(raw instanceof ExactNumber) && typeof raw !== 'number' && (typeof raw !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw.trim()))) invalid('A numeric column requires a JSON numeric value.');
        const value = raw instanceof ExactNumber ? raw : typeof raw === 'string' ? numericLexeme(raw.trim()) : raw; if (typeof value === 'number' && !Number.isFinite(value)) invalid('A numeric cell must be finite.'); cell.value = value;
    } else if (type === 'date') {
        if (typeof raw === 'string' && !raw.trim()) return cell;
        const match = typeof raw === 'string' ? /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?(Z|[+-]\d{2}:\d{2})?)?$/.exec(raw.trim()) : null;
        if (!match) invalid('Date columns require ISO yyyy-mm-dd or ISO datetime values.');
        const day = match[1]!, date = new Date(`${day}T00:00:00Z`), hour = Number(match[2] ?? 0), minute = Number(match[3] ?? 0), second = Number(match[4] ?? 0);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day || hour > 23 || minute > 59 || second > 59) invalid('Invalid ISO date or time.');
        if (match[6] && match[6] !== 'Z' && (Number(match[6].slice(1, 3)) > 24 || Number(match[6].slice(4)) > 60)) invalid('Invalid ISO timezone offset.');
        cell.value = (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000 + (hour * 3600 + minute * 60 + second + Number(`0.${match[5] ?? '0'}`)) / 86400;
    } else if (type === 'bool') { if (typeof raw !== 'boolean') invalid('Boolean columns require true or false.'); cell.value = raw; }
    else cell.value = type === 'string' ? (raw instanceof ExactNumber ? raw.lexeme : typeof raw === 'object' ? serializeTableInput(raw) : String(raw)) : raw;
    return cell;
}
function isObject(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function bounds(raw: unknown) {
    const parts = splitRange(String(raw)).range.split(':'), first = anchor(parts[0]), last = anchor(parts[1] ?? parts[0]);
    if (last.col < first.col || last.row < first.row) invalid('Style ranges must be ordered.');
    return { first, last };
}
export function checkTableStyleAnchor(sheet: TableSheet, row = sheet.start.row, checkRow = true) {
    for (const operation of sheet.styleOperations) if (operation.tool_name === 'set_cell_range') {
        const range = bounds((operation.input as JsonObject).range);
        if (range.first.col < sheet.start.col || (checkRow && range.first.row < row)) invalid('Cell styles cannot begin above or left of the table write anchor.');
    }
}
function styleItems(value: unknown): JsonObject[] {
    const raw = parse(value), items = Array.isArray(raw) ? raw : raw?.styles;
    if (!Array.isArray(items) || items.length > 100 || !items.every(isObject)) invalid('styles requires an array of at most 100 style objects.');
    const aliases: Record<string, string> = { sheet_name: 'name', sheet: 'name', title: 'name', cell_style: 'cell_styles', merges: 'cell_merges', merge_cells: 'cell_merges', cell_merge: 'cell_merges', row_heights: 'row_sizes', row_height: 'row_sizes', row_size: 'row_sizes', col_widths: 'col_sizes', col_width: 'col_sizes', column_widths: 'col_sizes', column_width: 'col_sizes', col_size: 'col_sizes' };
    return items.map(raw => {
        const item = structuredClone(raw);
        for (const alias of Object.keys(aliases).sort()) if (alias in item && !(aliases[alias]! in item)) { item[aliases[alias]!] = item[alias]; delete item[alias]; }
        for (const section of ['cell_styles', 'cell_merges', 'row_sizes', 'col_sizes']) if (isObject(item[section])) item[section] = [item[section]];
        if (item.border_styles !== undefined && Array.isArray(item.cell_styles) && item.cell_styles.length === 1 && isObject(item.cell_styles[0]) && !Object.keys(item.cell_styles[0]).some(key => ['borderstyles', 'border', 'bordertype', 'borders', 'borderall'].includes(key.toLowerCase().replaceAll(/[_-]/g, '')))) { item.cell_styles[0].border_styles = item.border_styles; delete item.border_styles; }
        return item;
    });
}
function styleExtent(operations: JsonObject[], start: { col: number; row: number }, cellOnly: boolean) {
    let rows = 0, cols = 0;
    for (const operation of operations) {
        const input = operation.input as JsonObject;
        if (operation.tool_name === 'set_cell_range' || (!cellOnly && operation.tool_name === 'merge_cells')) {
            const range = bounds(input.range);
            if (range.first.col >= start.col && range.first.row >= start.row) { rows = Math.max(rows, range.last.row - start.row + 1); cols = Math.max(cols, range.last.col - start.col + 1); }
        } else if (!cellOnly && operation.tool_name === 'resize_range') {
            const range = String(input.range ?? ''), axis = range.split(':');
            if (/^[0-9]+(?::[0-9]+)?$/.test(range)) rows = Math.max(rows, Number(axis.at(-1)) - start.row + 1);
            else if (/^[a-z]+(?::[a-z]+)?$/i.test(range)) cols = Math.max(cols, anchor(`${axis.at(-1)}1`).col - start.col + 1);
        }
    }
    return { rows, cols };
}
function labels(raw: unknown, columns: string[], inline: Record<string, string>): Record<string, string> {
    const out = { ...inline };
    if (raw === undefined || raw === null) return out;
    let declared: Record<string, string> = {};
    if (Array.isArray(raw)) {
        if (raw.length !== columns.length) invalid('Positional dtype and format arrays must match the declared columns.');
        raw.forEach((value, index) => {
            if (value === null) return;
            if (typeof value !== 'string') invalid('Column labels must be strings.');
            const label = value.trim(), name = columns[index]!; if (!label) return;
            if (declared[name] !== undefined && declared[name] !== label) invalid('Repeated column headings cannot have conflicting positional labels.');
            declared[name] = label;
        });
    } else {
        if (!isObject(raw) || Object.values(raw).some(value => typeof value !== 'string' && value !== null)) invalid('dtypes and formats must be string label maps.');
        declared = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value === null ? '' : String(value)]));
    }
    const combined = { ...out, ...declared }, normalized = (name: string) => name.toLowerCase().replaceAll(/\s/g, '');
    const folded: Record<string, string> = {};
    for (const key of Object.keys(combined).sort()) {
        const matches = [...new Set(columns.filter(column => column.trim() && normalized(column) === normalized(key)))];
        const target = columns.includes(key) && key.trim() ? key : matches.length === 1 ? matches[0]! : key;
        if (!columns.includes(target) || !target.trim()) invalid(`Unknown or ambiguous column label ${key}.`);
        if (target !== key && Object.hasOwn(combined, target)) continue;
        folded[target] = combined[key]!;
    }
    return folded;
}
export function tableWriteInput(args: JsonObject, create = false): TableSheet[] {
    if (create && (typeof args.title !== 'string' || !args.title.trim())) invalid('title is required.');
    if (args.values !== undefined && args.sheets !== undefined) invalid('values and sheets are mutually exclusive.');
    const valuesMode = create && args.sheets === undefined;
    const styles = args.styles === undefined ? undefined : styleItems(args.styles);
    if (valuesMode && styles && styles.length !== 1) invalid('Values mode requires exactly one style item.');
    let raw = parseTable(args.sheets);
    if (valuesMode) {
        const rows = args.values === undefined || args.values === '' ? [] : parseTable(args.values, true);
        if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row))) invalid('values must be a two-dimensional array.');
        if (!rows.length && !styles) return [];
        raw = [{ name: 'Sheet1', data: rows, header: false }];
    }
    if (raw === undefined) invalid('sheets is required.');
    const entries = Array.isArray(raw) ? raw : raw?.sheets;
    if (!Array.isArray(entries) || !entries.length || !entries.every(isObject)) invalid('sheets must contain a nonempty array of sheet objects.');
    const taken = new Set(entries.map(item => typeof item.name === 'string' ? item.name.trim() : '')); let nextName = 1;
    const generated = entries.map((item): JsonObject & { name: string } => {
        if (item.name !== undefined && typeof item.name !== 'string') invalid('Sheet name must be a string.');
        let name = String(item.name ?? '').trim();
        if (!name && create) { while (taken.has(`Sheet${nextName}`)) nextName++; name = `Sheet${nextName++}`; taken.add(name); }
        return { ...item, name };
    });
    if (styles && !valuesMode && styles.length !== generated.length) invalid('Typed style items must align one-to-one with sheets.');
    let budget = 0; const names = new Set<string>();
    return generated.map((item, index): TableSheet => {
        const name = item.name;
        if (!name || names.has(name)) invalid('Sheet names must be nonblank and unique.'); names.add(name);
        const columnsRaw = item.columns ?? [], original = item.data ?? [];
        if (!Array.isArray(columnsRaw) || !Array.isArray(original) || original.some(row => !Array.isArray(row))) invalid('columns and data must be arrays.');
        const inlineTypes: Record<string, string> = {}, inlineFormats: Record<string, string> = {};
        const columns = columnsRaw.map(raw => {
            if (typeof raw === 'string') return raw;
            if (!isObject(raw)) invalid('Columns require strings or named column objects.');
            const value = { ...raw }; let heading = typeof value.name === 'string' ? value.name : '';
            if (!heading.trim()) for (const alias of ['title', 'header', 'label', 'column', 'field', 'key']) if (typeof value[alias] === 'string' && value[alias].trim()) { heading = value[alias]; delete value[alias]; break; }
            if (!heading.trim()) invalid('Column objects require a heading.');
            for (const key of Object.keys(value).sort()) {
                if (key === 'name') continue;
                if (!['dtype', 'type', 'format', 'number_format'].includes(key) || typeof value[key] !== 'string') invalid('Column objects support only name, dtype, type, format and number_format strings.');
                if (value[key].trim()) (['dtype', 'type'].includes(key) ? inlineTypes : inlineFormats)[heading] = value[key];
            }
            return heading;
        });
        const dtypes = labels(item.dtypes, columns, inlineTypes), explicitFormats = labels(item.formats, columns, inlineFormats);
        const data = (original as unknown[][]).map(row => { const copy = [...row]; if (!valuesMode) while (copy.length > columns.length && (copy.at(-1) == null || typeof copy.at(-1) === 'string' && !String(copy.at(-1)).trim())) copy.pop(); return copy; });
        const width = Math.max(columns.length, 0, ...data.map(row => row.length));
        const inferred = columns.length === 0 && width > 0 && item.header !== true;
        if (!columns.length && data.length && !inferred) invalid('Rows require columns when an explicit header is enabled.');
        const declared = columns.length;
        while (columns.length < width) columns.push(inferred ? `col${columns.length + 1}` : '');
        const types: string[] = [], formats: string[] = [];
        columns.forEach((column, c) => {
            const dtype = String(dtypes[column] ?? '').trim().toLowerCase();
            const type = valuesMode || inferred || c >= declared ? '' : /^datetime/.test(dtype) || dtype === 'date' ? 'date' : /^(int|uint|float|complex)/.test(dtype) || ['number', 'numeric', 'decimal'].includes(dtype) ? 'number' : ['bool', 'boolean'].includes(dtype) ? 'bool' : 'string';
            types.push(type); formats.push((explicitFormats[column] ?? (type === 'date' ? 'yyyy-mm-dd' : type === 'string' ? '@' : '')).trim());
        });
        const mode = item.mode || 'overwrite'; if (!['overwrite', 'append'].includes(String(mode))) invalid('mode must be overwrite or append.');
        for (const flag of ['header', 'allow_overwrite']) if (item[flag] !== undefined && typeof item[flag] !== 'boolean') invalid(`${flag} must be boolean.`);
        const header = inferred ? false : item.header as boolean | undefined;
        const sheet: TableSheet = { name, columns, data, types, formats, mode: String(mode), header, allowOverwrite: item.allow_overwrite as boolean | undefined, start: anchor(item.start_cell), styleOperations: [] };
        if (styles) {
            const item = structuredClone(styles[index]!);
            if (!valuesMode && item.name !== name) invalid('Typed style names must match sheets in payload order.');
            if (valuesMode) {
                for (const section of ['cell_styles', 'cell_merges', 'row_sizes', 'col_sizes']) if (Array.isArray(item[section])) item[section] = item[section].map(entry => {
                    if (typeof entry === 'string') return splitRange(entry).range;
                    if (!isObject(entry) || typeof entry.range !== 'string') return entry;
                    const ref = splitRange(entry.range); if (item.name && ref.sheet && ref.sheet !== item.name) invalid('Style range conflicts with its sheet name.');
                    return { ...entry, range: ref.range };
                });
                item.name = name;
            }
            if (create && isObject(item.freeze) && !(Number(item.freeze.rows) || Number(item.freeze.cols))) invalid('New workbook freeze requires at least one positive axis.');
            if (Array.isArray(item.cell_styles)) for (const stamp of item.cell_styles) if (isObject(stamp)) bounds(stamp.range);
            sheet.styleOperations = stylesPlan({ styles: [item] }, '<token>').operations;
            checkTableStyleAnchor(sheet, sheet.start.row, create || mode !== 'append');
            if (valuesMode) {
                const extent = styleExtent(sheet.styleOperations, sheet.start, false);
                const cols = Math.max(sheet.columns.length, extent.cols), rows = Math.max(data.length, extent.rows);
                if (rows * cols > 1000000) invalid('Typed tables exceed the 1000000-cell budget.');
                while (sheet.columns.length < cols) { sheet.columns.push(`col${sheet.columns.length + 1}`); types.push(''); formats.push(''); }
                while (data.length < rows) data.push([]);
            }
        }
        const extent = styleExtent(sheet.styleOperations, sheet.start, true);
        budget += Math.max(data.length + ((header ?? mode !== 'append') ? 1 : 0), extent.rows) * Math.max(sheet.columns.length, extent.cols);
        if (budget > 1000000) invalid('Typed tables exceed the 1000000-cell budget.');
        data.forEach(row => sheet.columns.forEach((_, c) => typedCell(row[c], types[c]!, formats[c]!)));
        return sheet;
    });
}
export function tableMatrix(sheet: TableSheet, header: boolean, baseRow = sheet.start.row): JsonObject[][] {
    checkTableStyleAnchor(sheet, baseRow);
    const rows = sheet.data.map(row => sheet.columns.map((_, c) => typedCell(row[c], sheet.types[c]!, sheet.formats[c]!)));
    if (header && sheet.columns.length) rows.unshift(sheet.columns.map(value => ({ value })));
    const extent = styleExtent(sheet.styleOperations, { col: sheet.start.col, row: baseRow }, true);
    const width = Math.max(sheet.columns.length, extent.cols), height = Math.max(rows.length, extent.rows);
    if (width * height > 1000000) invalid('Styled table exceeds the 1000000-cell budget.');
    while (rows.length < height) rows.push([]);
    for (const row of rows) while (row.length < width) row.push({});
    for (const operation of sheet.styleOperations) if (operation.tool_name === 'set_cell_range') {
        const input = operation.input as JsonObject, range = bounds(input.range), cells = input.cells as JsonObject[][];
        for (let row = range.first.row; row <= range.last.row; row++) for (let col = range.first.col; col <= range.last.col; col++) {
            const cell = rows[row - baseRow]![col - sheet.start.col]!, style = cells[row - range.first.row]![col - range.first.col]!;
            for (const [key, value] of Object.entries(style)) cell[key] = (key === 'cell_styles' || key === 'border_styles') && isObject(value) ? { ...(isObject(cell[key]) ? cell[key] : {}), ...value } : structuredClone(value);
        }
    }
    return rows;
}

export function tableCreateDimensions(sheet: TableSheet): { rows: number; columns: number } {
    const extent = styleExtent(sheet.styleOperations, sheet.start, false);
    return { rows: Math.min(50000, Math.max(200, sheet.start.row - 1 + Math.max(sheet.data.length + ((sheet.header ?? true) ? 1 : 0), extent.rows))), columns: Math.min(200, Math.max(20, sheet.start.col - 1 + Math.max(sheet.columns.length, extent.cols))) };
}

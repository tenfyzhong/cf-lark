import { validateSheetFlag } from './validate';
import { parseSheetJSON } from './json';
import { normalizeTypedCell } from './normalize';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import { splitRange, dimensions } from './matrices';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function letter(index: number): string { let out = ''; while (index > 0) { index--; out = String.fromCharCode(65 + index % 26) + out; index = Math.floor(index / 26); } return out; }
function one(args: JsonObject, token: unknown, warnings: string[]): JsonObject {
    const raw = String(args.range || args['start-cell'] || '').trim();
    if (!raw) invalid('range or start-cell is required.');
    const ref = splitRange(raw), target = dimensions(ref.range);
    const id = args['sheet-id'], name = args['sheet-name'] || ref.sheet;
    if (id && name && !ref.sheet) invalid('Sheet selectors are mutually exclusive.');
    if (ref.sheet && args['sheet-name'] && ref.sheet.toLowerCase() !== String(args['sheet-name']).toLowerCase()) invalid('Range sheet and sheet-name disagree.');
    if (args.cells === undefined) invalid('cells is required.');
    let rawCells = parseSheetJSON(args.cells);
    if (rawCells && typeof rawCells === 'object' && !Array.isArray(rawCells) && Object.hasOwn(rawCells, 'cells')) rawCells = (rawCells as JsonObject).cells;
    let cells: unknown[] = Array.isArray(rawCells) ? rawCells : [[rawCells]];
    if (cells.length && cells.every(cell => !Array.isArray(cell))) cells = target.cols === 1 && target.rows > 1 ? cells.map(cell => [cell]) : [cells];
    const width = cells.reduce<number>((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
    if (!cells.length || !width || cells.some(row => !Array.isArray(row))) invalid('cells must be a nonempty cell matrix.');
    if (cells.length * width > 200000) invalid('Cell matrix exceeds the 200000-cell safety cap.');
    const anchored = !ref.range.includes(':');
    if (!anchored && (cells.length > target.rows || width > target.cols)) invalid('Cell payload exceeds the explicitly requested range.');
    const anchor = /^\$?([a-z]+)\$?([0-9]+)/i.exec(ref.range)!;
    const col = [...anchor[1]!.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    const start = `${anchor[1]!.toUpperCase()}${anchor[2]}`, end = `${letter(col + width - 1)}${Number(anchor[2]) + cells.length - 1}`;
    const range = start === end ? start : `${start}:${end}`;
    if (!anchored && range !== ref.range) warnings.push(`Write narrowed from ${raw} to ${range}; only the provided cells are touched.`);
    const normalized = (cells as unknown[][]).map(row => [...row, ...Array.from({ length: width - row.length }, () => ({}))].map(cell => cell !== null && typeof cell === 'object' ? normalizeTypedCell(cell as JsonObject) : typeof cell === 'string' && cell.startsWith('=') ? { formula: cell } : { value: cell }));
    validateSheetFlag('cells-set', 'cells', normalized);
    return { excel_id: token, ...(id ? { sheet_id: id } : name ? { sheet_name: name } : {}), range, cells: normalized,
        ...(args['allow-overwrite'] === false ? { allow_overwrite: false } : {}), ...(args['copy-to-range'] ? { copy_to_range: args['copy-to-range'] } : {}) };
}
export function cellWriteInput(args: JsonObject, value: JsonObject): void {
    const warnings: string[] = [];
    if (args.writes !== undefined) {
        if (args.cells !== undefined || args.range !== undefined || args['start-cell'] !== undefined || args['copy-to-range'] !== undefined) invalid('writes cannot be combined with standalone cell payload flags.');
        let rawWrites = parseSheetJSON(args.writes);
        if (rawWrites && typeof rawWrites === 'object' && !Array.isArray(rawWrites) && Object.hasOwn(rawWrites, 'writes')) rawWrites = (rawWrites as JsonObject).writes;
        const writes = Array.isArray(rawWrites) ? rawWrites : [rawWrites];
        if (!writes.length || writes.length > 100) invalid('Provide one to 100 writes.');
        let total = 0;
        const operations = writes.map(raw => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('Each write must be an object.');
            const item = Object.fromEntries(Object.entries(raw).map(([key, entry]) => [key.replaceAll('_', '-'), entry]));
            if (item.values !== undefined) { if (item.cells !== undefined) invalid('values conflicts with cells.'); item.cells = item.values; delete item.values; }
            const result = one({ 'sheet-id': args['sheet-id'], 'sheet-name': args['sheet-name'], 'allow-overwrite': args['allow-overwrite'], ...item }, value.excel_id, warnings);
            if (!result.sheet_id && !result.sheet_name) invalid('Each scattered write requires a sheet selector.');
            const cells = result.cells as unknown[][]; total += cells.length * cells[0]!.length;
            if (total > 200000) invalid('Scattered writes exceed the aggregate 200000-cell safety cap.');
            return { tool_name: 'set_cell_range', input: result };
        });
        for (const key of Object.keys(value)) if (key !== 'excel_id') delete value[key];
        value.operations = operations;
    } else Object.assign(value, one({ ...args, 'sheet-id': value.sheet_id, 'sheet-name': value.sheet_name }, value.excel_id, warnings));
    if (warnings.length) value.__warnings = warnings;
}

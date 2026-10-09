import { validateSheetFlag } from './validate';
import { normalizeCellStyle, normalizeBorders } from './normalize';
import { parseSheetJSON } from './json';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import { jsonArray, matrix, splitRange } from './matrices';
export const styleFlags = ['background-color', 'font-color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-line', 'horizontal-alignment', 'vertical-alignment', 'word-wrap', 'number-format'];
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function cellStyle(args: JsonObject): JsonObject {
    const style = Object.fromEntries(styleFlags.filter(flag => flag === 'font-size' ? typeof args[flag] === 'number' && args[flag] > 0 : typeof args[flag] === 'string' && !!args[flag]).map(flag => [flag.replaceAll('-', '_'), args[flag]]));
    const cell: JsonObject = {};
    if (Object.keys(style).length) cell.cell_styles = normalizeCellStyle(style);
    if (args['border-styles'] !== undefined) {
        let borders = args['border-styles'];
        if (typeof borders === 'string') { try { borders = parseSheetJSON(borders); } catch { invalid('border-styles must be valid JSON.'); } }
        cell.border_styles = normalizeBorders(borders);
        validateSheetFlag('cells-set-style', 'border-styles', cell.border_styles);
    }
    if (!Object.keys(cell).length) invalid('At least one style flag is required.');
    return cell;
}
export function styleInput(name: string, args: JsonObject, value: JsonObject): void {
    const cell = name === 'cells-batch-clear' ? {} : cellStyle(args);
    const budget = { total: 0 };
    if (name === 'cells-set-style') {
        if (typeof args.range !== 'string' || !args.range.trim()) invalid('range is required.');
        value.range = args.range.trim(); value.cells = matrix(value.range as string, cell, budget); return;
    }
    const ranges = jsonArray(args.ranges);
    if (!ranges.length || ranges.length > 100) invalid('Provide one to 100 ranges.');
    value.operations = ranges.map(raw => {
        if (typeof raw !== 'string') invalid('Each range must be a string.');
        const ref = splitRange(raw);
        if (!ref.sheet) invalid('Each range requires a sheet prefix.');
        return { tool_name: name === 'cells-batch-clear' ? 'clear_cell_range' : 'set_cell_range', input: { excel_id: value.excel_id, sheet_name: ref.sheet, range: ref.range, ...(name === 'cells-batch-clear' ? { clear_type: args.scope === 'all' || args.scope === 'formats' ? args.scope : 'contents' } : { cells: matrix(ref.range, cell, budget) }) } };
    });
}

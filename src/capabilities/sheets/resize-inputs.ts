import { validateSheetFlag } from './validate';
import { parseSheetJSON } from './json';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function span(raw: string, column: boolean) {
    const parts = raw.trim().split(':');
    if (parts.length > 2 || parts.some(v => column ? !/^[a-z]+$/i.test(v) : !/^[1-9][0-9]*$/.test(v))) invalid('Range must contain ordered positions on the selected axis.');
    const index = (v: string) => column ? [...v.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) : Number(v);
    const start = index(parts[0]!), end = index(parts.at(-1)!);
    if (start > end || !Number.isSafeInteger(end)) invalid('Invalid dimension range.');
    return { start, end, range: parts.length === 1 ? `${parts[0]}:${parts[0]}` : raw.trim() };
}
function size(value: unknown, column: boolean): JsonObject {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && (!column || value >= 20)) return { type: 'pixel', value };
    if (value === 'standard' || (!column && value === 'auto')) return { type: value };
    invalid('Use positive integer pixel sizes (columns at least 20), standard, or rows-only auto.');
}
export function resizeInput(name: string, args: JsonObject, value: JsonObject): void {
    const column = name === 'cols-resize', sizeFlag = column ? 'width' : 'height', mapFlag = column ? 'widths' : 'heights', wire = column ? 'resize_width' : 'resize_height';
    if (args[mapFlag] !== undefined) {
        if (['range', sizeFlag, 'type'].some(key => Object.hasOwn(args, key))) invalid('Size maps cannot be combined with range, pixel size, or type.');
        let raw = args[mapFlag];
        if (typeof raw === 'string') { try { raw = parseSheetJSON(raw); } catch { invalid('Size map must be valid JSON.'); } }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('Size map must be an object.');
        validateSheetFlag(name, mapFlag, raw);
        const entries = Object.entries(raw);
        if (!entries.length || entries.length > 100) invalid('Provide one to 100 size entries.');
        const ranges = entries.map(([range, pixels]) => ({ ...span(range, column), block: size(pixels, column) })).sort((a, b) => a.start - b.start || a.end - b.end);
        if (ranges.some((range, i) => i > 0 && range.start <= ranges[i - 1]!.end)) invalid('Size map ranges must not overlap.');
        value.operations = ranges.map(range => ({ tool_name: 'resize_range', input: { excel_id: value.excel_id, ...(value.sheet_id ? { sheet_id: value.sheet_id } : {}), ...(value.sheet_name ? { sheet_name: value.sheet_name } : {}), range: range.range, [wire]: range.block } }));
        delete value.sheet_id; delete value.sheet_name;
    } else {
        if (typeof args.range !== 'string') invalid('range is required.');
        const range = span(args.range, column);
        if (args[sizeFlag] !== undefined && args.type !== undefined && args.type !== 'pixel') invalid('Pixel size cannot be combined with a non-pixel type.');
        value.range = range.range;
        value[wire] = size(args[sizeFlag] ?? args.type, column);
    }
}

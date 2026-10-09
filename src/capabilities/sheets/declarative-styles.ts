import { parseSheetJSON } from './json';
import { normalizeTypedCell } from './normalize';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import { styleInput } from './styles';
import { resizeInput } from './resize-inputs';
import { splitRange, dimensions } from './matrices';
export type SheetGrids = Record<string, { rows: number; cols: number }>;
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function object(value: unknown): JsonObject { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected an object in the styles specification.'); return value as JsonObject; }
function letter(index: number): string { let out = ''; while (index > 0) { index--; out = String.fromCharCode(65 + index % 26) + out; index = Math.floor(index / 26); } return out; }
export function stylesPlan(args: JsonObject, token: string, grids?: SheetGrids): { operations: JsonObject[]; needsGrid: boolean } {
    let raw = args.styles;
    if (typeof raw === 'string') { try { raw = parseSheetJSON(raw); } catch { invalid('styles must be valid JSON.'); } }
    const items = Array.isArray(raw) ? raw : object(raw).styles;
    if (!Array.isArray(items) || !items.length) invalid('styles requires a nonempty styles array.');
    const operations: JsonObject[] = [], names = new Set<string>(); let cells = 0, needsGrid = false;
    for (const rawItem of items) {
        const item = object(rawItem), name = typeof item.name === 'string' ? item.name.trim() : '';
        if (!name || names.has(name)) invalid('Style items require unique nonblank sheet names.');
        names.add(name);
        if (Object.keys(item).some(key => !['name', 'cell_merges', 'cell_styles', 'row_sizes', 'col_sizes', 'freeze'].includes(key))) invalid('Unknown style item field.');
        const range = (rawRange: unknown, bound: boolean): string => {
            if (typeof rawRange !== 'string' || !rawRange.trim()) invalid('Each style operation requires a range.');
            const ref = splitRange(rawRange);
            if (ref.sheet && ref.sheet !== name) invalid('Style range prefix conflicts with the item sheet name.');
            if (bound && (/^[a-z]+:[a-z]+$/i.test(ref.range) || /^[1-9][0-9]*:[1-9][0-9]*$/.test(ref.range))) {
                needsGrid = true;
                const grid = grids?.[name];
                if (grids && !grid) invalid('No grid dimensions were returned for the style target.');
                const parts = ref.range.split(':');
                return /^[a-z]/i.test(ref.range) ? `${parts[0]}1:${parts[1]}${grid?.rows ?? 1}` : `A${parts[0]}:${letter(grid?.cols ?? 1)}${parts[1]}`;
            }
            return ref.range;
        };
        const list = (key: string) => { const entries = item[key] ?? []; if (!Array.isArray(entries) || entries.length > 1000) invalid('Style sections must be arrays with at most 1000 entries.'); return entries; };
        const append = (tool_name: string, input: JsonObject) => operations.push({ tool_name, input: { excel_id: token, sheet_name: name, ...input } });
        for (const rawMerge of list('cell_merges')) {
            const merge = typeof rawMerge === 'string' ? { range: rawMerge } : object(rawMerge);
            const target = range(merge.range, false); dimensions(target);
            const type = String(merge.merge_type ?? 'all').toLowerCase().replace(/^merge_/, '');
            if (!['all', 'rows', 'columns'].includes(type)) invalid('Invalid merge type.');
            append('merge_cells', { range: target, operation: 'merge', merge_type: type });
        }
        for (const rawStyle of list('cell_styles')) {
            const original = object(rawStyle), target = range(original.range, true), dim = dimensions(target);
            const normalized = normalizeTypedCell(Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'range')));
            if (Object.keys(normalized).some(key => !['cell_styles', 'border_styles'].includes(key))) invalid('Style stamps cannot contain values or unsupported fields.');
            const style = { ...(normalized.cell_styles as JsonObject ?? {}), ...(normalized.border_styles !== undefined ? { border_styles: normalized.border_styles } : {}) };
            cells += dim.rows * dim.cols; if (cells > 200000) invalid('Styles exceed the aggregate 200000-cell safety cap.');
            const translated: JsonObject = { excel_id: token, sheet_name: name };
            styleInput('cells-set-style', { ...Object.fromEntries(Object.entries(style).map(([key, val]) => [key.replaceAll('_', '-'), val])), range: target }, translated);
            operations.push({ tool_name: 'set_cell_range', input: translated });
        }
        for (const [section, command, alias, wrong] of [['row_sizes', 'rows-resize', 'height', 'width'], ['col_sizes', 'cols-resize', 'width', 'height']] as const) {
            for (const rawSize of list(section)) {
                const size = object(rawSize);
                if (Object.hasOwn(size, wrong) || (size.size !== undefined && size[alias] !== undefined)) invalid('Use one dimension size field.');
                const pixels = size.size ?? size[alias], type = size.type === 'custom' && pixels !== undefined ? 'pixel' : size.type;
                const translated: JsonObject = { excel_id: token, sheet_name: name };
                resizeInput(command, { range: range(size.range, false), ...(pixels !== undefined ? { [alias]: pixels } : {}), ...(type !== undefined ? { type } : {}) }, translated);
                operations.push({ tool_name: 'resize_range', input: translated });
            }
        }
        if (item.freeze !== undefined) {
            const freeze = object(item.freeze), rows = freeze.rows ?? 0, cols = freeze.cols ?? 0;
            if (typeof rows !== 'number' || typeof cols !== 'number' || !Number.isSafeInteger(rows) || !Number.isSafeInteger(cols) || rows < 0 || cols < 0) invalid('Freeze axes must be nonnegative integers.');
            append('modify_sheet_structure', { operation: rows || cols ? 'freeze' : 'unfreeze', ...(rows ? { freeze_rows: rows } : {}), ...(cols ? { freeze_columns: cols } : {}) });
        }
    }
    if (!operations.length) invalid('The style specification contains no operations.');
    return { operations, needsGrid };
}

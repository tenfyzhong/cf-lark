import { validateSheetFlag } from './validate';
import { parseSheetJSON } from './json';
import { dimensions, rangeAreas } from './matrices';
import { resizeInput } from './resize-inputs';
import { csvInput } from './csv';
import { styleInput } from './styles';
import { cellWriteInput } from './cell-writes';
import { dropdownInput, jsonArray } from './matrices';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function integer(value: unknown, min = 0): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) invalid(`Expected an integer at least ${min}.`);
    return value;
}
function position(value: string): { column: boolean; index: number } {
    if (/^[0-9]+$/.test(value)) return { column: false, index: integer(Number(value), 1) };
    if (!/^[a-z]+$/i.test(value)) invalid('Expected a row number or column letters.');
    return { column: true, index: [...value.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) };
}
function letter(value: number): string {
    let out = '';
    while (value > 0) { value--; out = String.fromCharCode(65 + value % 26) + out; value = Math.floor(value / 26); }
    return out;
}
export function enrichInput(name: string, args: JsonObject, value: JsonObject): void {
    if (name === 'formula-verify') {
        const list = (key: string) => {
            if (args[key] === undefined) return [];
            if (!Array.isArray(args[key]) || args[key].some(v => typeof v !== 'string' || /[\x00-\x1f\x7f]/.test(v))) invalid(`${key} must be a string array without control characters.`);
            return (args[key] as string[]).map(v => v.trim()).filter(Boolean);
        };
        const ids = list('sheet-id'), names = list('sheet-name'), ranges = list('range');
        if (ids.length && names.length) invalid('sheet-id and sheet-name are mutually exclusive.');
        if (ids.length) value.sheet_ids = ids;
        if (names.length) value.sheet_names = names;
        if (ranges.length) value.ranges = ranges;
        if (Object.hasOwn(args, 'max-locations')) value.max_locations_per_error = integer(args['max-locations'], 1);
        if (args['ai-only'] === true) value.ai_only = true;
    }
    if (name === 'rows-resize'  || name === 'cols-resize') resizeInput(name, args, value);
    if (name === 'csv-put') csvInput(args, value);
    if (['cells-set-style', 'cells-batch-set-style', 'cells-batch-clear'].includes(name)) styleInput(name, args, value);
    if (name === 'cells-set') cellWriteInput(args, value);
    if (['dropdown-set', 'dropdown-update', 'dropdown-delete'].includes(name)) dropdownInput(name, args, value);
    if (['cells-clear', 'cells-merge', 'cells-unmerge', 'dropdown-get'].includes(name)) {
        const range = text(args.range);
        if (!range) invalid('range is required.');
        if (name === 'dropdown-get') {
            value.ranges = rangeAreas(range);
            value.include_styles = false; value.value_render_option = 'formatted_value';
        } else {
            value.range = range;
            if (name === 'cells-clear') value.clear_type = args.scope === 'formats' || args.scope === 'all' ? args.scope : 'contents';
            else { value.operation = name.slice(6); if (name === 'cells-merge') value.merge_type = args['merge-type'] || 'all'; }
        }
    }
    if (name === 'sheet-info') {
        if (text(args.range)) value.range = text(args.range);
        if (Array.isArray(args.include) && args.include.length) {
            const groups: Record<string, string> = { row_heights: 'row_heights_column_widths', col_widths: 'row_heights_column_widths', hidden_rows: 'hidden_infos', hidden_cols: 'hidden_infos', groups: 'group_infos', merges: 'merged_cells_infos' };
            const selected = new Set(args.include.map(v => groups[String(v)] ?? 'all'));
            value.info_type = selected.size === 1 ? [...selected][0] : 'all';
        }
    }
    if (['cells-get', 'csv-get', 'cond-format-result-get'].includes(name)) {
        const range = text(args.range);
        if (name !== 'csv-get' && !range) invalid('range is required.');
        if (name === 'csv-get') { value.range = range || 'A:ZZZ'; value.max_rows = 1000000000; }
        else { value.ranges = rangeAreas(range); value.cell_limit = 1000000000; }
        const cap = args['max-chars'];
        value.max_chars = typeof cap === 'number' && cap > 0 ? cap : text(args['output-path']) ? 20000000 : 500000;
        if (args['skip-hidden'] === true) value.skip_hidden = true;
        if (name === 'cond-format-result-get') { value.include_styles = true; value.include_conditional_format_style = true; }
        else if (name === 'cells-get' && Array.isArray(args.include) && args.include.length) {
            value.include_styles = args.include.includes('style') || args.include.includes('conditional_format');
            if (args.include.includes('conditional_format')) value.include_conditional_format_style = true;
            if (args.include.includes('formula')) value.value_render_option = 'formula';
            if (args.include.includes('truncation')) value.include_truncation_info = true;
        }
    }
    if (name === 'cells-search' || name === 'cells-replace') {
        if (!text(args.find)) invalid('find is required.');
        value.search_term = args.find;
        if (text(args.range)) value.range = text(args.range);
        const options: JsonObject = {};
        for (const [flag, key] of [['match-case', 'match_case'], ['match-entire-cell', 'match_entire_cell'], ['regex', 'use_regex'], ['include-formulas', 'match_formulas']] as const) if (args[flag] === true) options[key] = true;
        if (Object.keys(options).length) value.options = options;
        if (name === 'cells-search') {
            if (typeof args.offset === 'number' && args.offset > 0) value.offset = args.offset;
            const max = args['max-matches'] ?? 5000;
            if (typeof max === 'number' && max > 0) value.max_matches = max;
        } else {
            if (typeof args.replacement !== 'string') invalid('replacement is required; empty string deletes matches.');
            value.replace_term = args.replacement;
        }
    }
    if (name === 'cells-set-image') {
        const size = dimensions(String(args.range ?? ''));
        if (size.rows !== 1 || size.cols !== 1) invalid('Image range must contain exactly one cell.');
        if (!text(args.image)) invalid('image must reference a private artifact.');
        value.range = text(args.range);
    }
    if (name === 'float-image-update' || name === 'float-image-create') {
        if (name === 'float-image-update' && !text(args['float-image-id'])) invalid('float-image-id is required.');
        const imageName = text(args['image-name']) || text(args.image);
        if (!imageName) invalid('image-name is required.');
        const sources = [args.image, args['image-token'], args['image-uri']].filter(v => !!v);
        if (sources.length > 1 || (name === 'float-image-create' && sources.length !== 1)) invalid('Provide exactly one image, image-token, or image-uri.');
        if (!Object.hasOwn(args, 'position-row') || !text(args['position-col']) || !Object.hasOwn(args, 'size-width') || !Object.hasOwn(args, 'size-height')) invalid('Complete position and size are required.');
        if (text(args['image-token']) && text(args['image-uri'])) invalid('Image token and URI are mutually exclusive.');
        const props: JsonObject = { image_name: imageName, position: { row: args['position-row'], col: text(args['position-col']) }, size: { width: args['size-width'], height: args['size-height'] } };
        if (text(args['image-token'])) props.image_token = text(args['image-token']);
        if (text(args['image-uri'])) props.image_uri = text(args['image-uri']);
        if (Object.hasOwn(args, 'offset-row') || Object.hasOwn(args, 'offset-col')) props.offset = { ...(Object.hasOwn(args, 'offset-row') ? { row_offset: args['offset-row'] } : {}), ...(Object.hasOwn(args, 'offset-col') ? { col_offset: args['offset-col'] } : {}) };
        if (Object.hasOwn(args, 'z-index')) props.z_index = args['z-index'];
        value.operation = name === 'float-image-create' ? 'create' : 'update'; value.properties = props;
    }
    if (name.startsWith('range-')) {
        value.operation = name.slice(6);
        if (name === 'range-sort') {
            if (!text(args.range)) invalid('range is required.');
            let keys = args['sort-keys'];
            if (typeof keys === 'string') { try { keys = parseSheetJSON(keys); } catch { invalid('sort-keys must contain valid JSON.'); } }
            if (!Array.isArray(keys) || keys.some(key => !key || typeof key.column !== 'string' || typeof key.ascending !== 'boolean')) invalid('sort-keys requires column and ascending on every item.');
            validateSheetFlag('range-sort', 'sort-keys', keys);
            value.range = text(args.range); value.sort_conditions = keys;
            if (args['has-header'] === true) value.has_header = true;
        } else {
            if (!text(args['source-range']) || !text(args['target-range'])) invalid('source-range and target-range are required.');
            value.range = text(args['source-range']); value.destination_range = text(args['target-range']);
            if (name !== 'range-fill' && text(args['target-sheet-id'])) value.destination_sheet_id = text(args['target-sheet-id']);
            if (name === 'range-fill') value.fill_type = args['series-type'] === 'copy' ? 'copyCells' : 'fillSeries';
            if (name === 'range-copy' && args['paste-type'] && args['paste-type'] !== 'all') value.paste_type = ({ values: 'value_only', formulas: 'formula_only', formats: 'format_only' } as Record<string, string>)[String(args['paste-type'])] ?? 'all';
        }
    }
    if (name === 'sheet-move') { value.operation = 'move'; value.target_index = integer(args.index); value.source_index = Object.hasOwn(args, 'source-index') ? integer(args['source-index']) : '<resolve>'; }
    if (name === 'dim-move') { value.native_body = moveBody(args); return; }
    if (!name.startsWith('dim-')) return;
    if (name === 'dim-delete' && args.ranges !== undefined) {
        if (Object.hasOwn(args, 'range')) invalid('range and ranges are mutually exclusive.');
        const ranges = jsonArray(args.ranges);
        if (!ranges.length || ranges.length > 100) invalid('Provide one to 100 ranges.');
        const spans = ranges.map(raw => {
            if (typeof raw !== 'string') invalid('Every range must be a string.');
            const segments = raw.trim().split(':');
            if (segments.length > 2) invalid('Invalid dimension range.');
            const start = position(segments[0]!), end = position(segments.at(-1)!);
            if (start.column !== end.column || start.index > end.index) invalid('Invalid dimension range.');
            return { raw: raw.trim(), start: start.index, end: end.index, column: start.column };
        }).sort((a, b) => b.start - a.start);
        if (spans.some(span => span.column !== spans[0]!.column) || spans.some((span, i) => i > 0 && span.end >= spans[i - 1]!.start)) invalid('Ranges must use one axis and must not overlap.');
        value.operations = spans.map(span => ({ tool_name: 'modify_sheet_structure', input: { excel_id: value.excel_id, ...(value.sheet_id ? { sheet_id: value.sheet_id } : {}), ...(value.sheet_name ? { sheet_name: value.sheet_name } : {}), operation: 'delete', range: span.raw } }));
        delete value.sheet_id; delete value.sheet_name;
        return;
    }
    const action = name.slice(4);
    value.operation = action;
    if (action === 'freeze') {
        const axis = Object.hasOwn(args, 'rows') || Object.hasOwn(args, 'cols');
        const pair = Object.hasOwn(args, 'dimension') || Object.hasOwn(args, 'count');
        if (axis === pair) invalid('Provide rows/cols or dimension/count, exclusively.');
        if (pair && (!['row', 'column'].includes(String(args.dimension)) || !Object.hasOwn(args, 'count'))) invalid('dimension and count must be supplied together.');
        const rows = axis ? integer(args.rows ?? 0) : args.dimension === 'row' ? integer(args.count) : 0;
        const cols = axis ? integer(args.cols ?? 0) : args.dimension === 'column' ? integer(args.count) : 0;
        value.operation = rows || cols ? 'freeze' : 'unfreeze';
        if (rows) value.freeze_rows = rows;
        if (cols) value.freeze_columns = cols;
    } else if (action === 'insert') {
        const raw = text(args.position), pos = position(raw);
        value.position = raw; value.count = integer(args.count, 1);
        if (args['inherit-style'] === 'before') {
            if (pos.index > 1) { value.position = pos.column ? letter(pos.index - 1) : String(pos.index - 1); value.side = 'after'; }
        } else value.side = 'before';
    } else {
        const raw = text(args.range), segments = raw.split(':');
        if (segments.length > 2) invalid('Invalid dimension range.');
        const start = position(segments[0]!), end = position(segments.at(-1)!);
        if (start.column !== end.column || start.index > end.index) invalid('Dimension range must be ordered and use one axis.');
        value.range = raw;
        if (action === 'group') value.group_state = args['group-state'] ?? 'expand';
    }
}

export function moveBody(args: JsonObject): JsonObject {
    const segments = text(args['source-range']).split(':');
    if (segments.length > 2) invalid('Invalid source-range.');
    const start = position(segments[0]!), end = position(segments.at(-1)!), target = position(text(args.target));
    if (start.column !== end.column || start.column !== target.column || start.index > end.index) invalid('Source and target must use the same axis and an ordered source range.');
    return { source: { major_dimension: start.column ? 'COLUMNS' : 'ROWS', start_index: start.index - 1, end_index: end.index - 1 }, destination_index: target.index - 1 };
}

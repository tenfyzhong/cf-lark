import { parseSheetJSON } from './json';
import { splitRange } from './matrices';
import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
import { anchor, letter } from './table-write-input';
export function chartInvalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
const kinds = ['column', 'bar', 'line', 'area', 'pie', 'scatter', 'combo', 'radar', 'bubble', 'waterfall', 'pareto'];
const semantic = ['title', 'subtitle', 'legend-position', 'x-axis-title', 'y-axis-title', 'secondary-y-axis-title', 'x-axis-label-angle', 'y-axis-label-angle', 'x-axis-min', 'x-axis-max', 'y-axis-min', 'y-axis-max', 'data-labels', 'data-label-position', 'stack', 'color-palette', 'smooth', 'aggregate-categories'];
export function list(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String);
    const raw = String(value ?? '').trim();
    if (raw.startsWith('[')) { try { const values = parseSheetJSON(raw); if (Array.isArray(values)) return values.map(String); } catch { chartInvalid('Expected a JSON array or comma-separated list.'); } }
    const result: string[] = []; let quoted = false, start = 0;
    for (let i = 0; i <= raw.length; i++) {
        if (raw[i] === "'") { if (quoted && raw[i + 1] === "'") i++; else quoted = !quoted; }
        if (i === raw.length || (raw[i] === ',' && !quoted)) { const part = raw.slice(start, i).trim(); if (!part) chartInvalid('List contains an empty item.'); result.push(part); start = i + 1; }
    }
    if (quoted) chartInvalid('Unterminated quoted sheet name.');
    return result;
}
export function chartConfig(args: JsonObject): JsonObject {
    const result: JsonObject = {};
    for (const key of semantic) if (args[key] !== undefined) result[key.replaceAll('-', '_')] = args[key];
    if (args.stack !== undefined && args.stacked !== undefined) chartInvalid('stack and stacked are mutually exclusive.');
    if (args.stacked !== undefined) result.stack = args.stacked ? 'normal' : 'none';
    const enums: Record<string, string[]> = { 'legend-position': ['top', 'bottom', 'left', 'right', 'hidden'], stack: ['none', 'normal', 'percent'], 'data-labels': ['none', 'series', 'category', 'value', 'percentage', 'value_category', 'category_percentage', 'value_percentage', 'value_category_percentage'] };
    for (const [key, values] of Object.entries(enums)) if (args[key] !== undefined && !values.includes(String(args[key]))) chartInvalid(`Invalid ${key}.`);
    if (args.colors !== undefined) {
        if (args['color-palette'] !== undefined) chartInvalid('colors and color-palette are mutually exclusive.');
        const colors = list(args.colors); if (colors.length < 2 || colors.some(c => !/^#?[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(c))) chartInvalid('colors must contain hexadecimal colors.');
        result.colors = colors.map(c => c.startsWith('#') ? c : `#${c}`);
    }
    for (const axis of ['x', 'y']) {
        const min = args[`${axis}-axis-min`], max = args[`${axis}-axis-max`];
        if ([min, max].some(v => v !== undefined && (typeof v !== 'number' || !Number.isFinite(v)))) chartInvalid('Axis bounds must be finite numbers.');
        if (min !== undefined && max !== undefined && Number(min) >= Number(max)) chartInvalid('Axis minimum must be below maximum.');
    }
    return result;
}
export function chartData(args: JsonObject, kind: string, existing: JsonObject = {}): { basic: JsonObject; dim1: number; indexes: number[]; roles: string[]; refs: string[]; dimensionCount: number } {
    if (kind && !kinds.includes(kind)) chartInvalid('Unsupported basic chart type.');
    const direction = String(args['data-direction'] ?? existing.direction ?? 'column');
    if (!['row', 'column'].includes(direction)) chartInvalid('data-direction must be row or column.');
    const ranges = list(args['data-range']); if (!ranges.length) chartInvalid('data-range is required.');
    const boxes = ranges.map(range => { const parts = splitRange(range).range.replaceAll('$', '').split(':'); if (parts.length !== 2) chartInvalid('Chart data requires bounded A1 ranges.'); const start = anchor(parts[0]), end = anchor(parts[1]); if (end.col < start.col || end.row < start.row) chartInvalid('Chart data ranges must be ordered.'); const ref = splitRange(range); return { start, end, sheet: ref.sheet ?? '', prefix: ref.sheet ? range.slice(0, range.length - ref.range.length) : '' }; });
    const aligned = boxes.every(b => direction === 'column' ? b.start.row === boxes[0]!.start.row && b.end.row === boxes[0]!.end.row : b.start.col === boxes[0]!.start.col && b.end.col === boxes[0]!.end.col);
    const merged = { start: { col: Math.min(...boxes.map(b => b.start.col)), row: Math.min(...boxes.map(b => b.start.row)) }, end: { col: Math.max(...boxes.map(b => b.end.col)), row: Math.max(...boxes.map(b => b.end.row)) } };
    const overlap = boxes.some((box, i) => boxes.slice(0, i).some(other => box.sheet === other.sheet && (direction === 'column' ? box.start.col <= other.end.col && other.start.col <= box.end.col : box.start.row <= other.end.row && other.start.row <= box.end.row)));
    if ((!aligned || overlap) && new Set(boxes.map(box => box.sheet)).size > 1) chartInvalid('Cross-sheet chart ranges must align and must not overlap.');
    const selected = aligned && !overlap ? boxes : [{ ...merged, prefix: boxes[0]!.prefix, sheet: boxes[0]!.sheet }];
    const refs = selected.map(b => `${b.prefix}${letter(b.start.col)}${b.start.row}:${letter(b.end.col)}${b.end.row}`);
    const dimensions = selected.reduce((n, b) => n + (direction === 'column' ? b.end.col - b.start.col + 1 : b.end.row - b.start.row + 1), 0);
    const points = direction === 'column' ? selected[0]!.end.row - selected[0]!.start.row + 1 : selected[0]!.end.col - selected[0]!.start.col + 1;
    if (dimensions < 2 || points < 2) chartInvalid('Chart data requires at least two dimensions and two data points.');
    if (args['header-range'] !== undefined) {
        let count = 0;
        for (const raw of list(args['header-range'])) {
            const [first, last] = splitRange(raw).range.replaceAll('$', '').split(':');
            const start = anchor(first), end = anchor(last ?? first);
            if (end.row < start.row || end.col < start.col || (direction === 'column' ? start.row !== end.row : start.col !== end.col)) chartInvalid('Detached header ranges must follow the chart data orientation.');
            count += direction === 'column' ? end.col - start.col + 1 : end.row - start.row + 1;
        }
        if (count !== dimensions) chartInvalid('Detached header count must equal the data dimension count.');
    }
    const roleFlags = ['x-index', 'y-index', 'group-index', 'size-index'], useRoles = ['key-index', ...roleFlags].some(key => args[key] !== undefined);
    if (useRoles && kind && kind !== 'bubble') chartInvalid('Role indexes require a bubble chart.');
    if (useRoles && (args['dim1-index'] !== undefined || args['dim2-indexes'] !== undefined || args['x-index'] === undefined || args['y-index'] === undefined)) chartInvalid('Bubble roles require x-index and y-index and exclude dimension-index flags.');
    const dim1 = Number(args[useRoles ? 'key-index' : 'dim1-index'] ?? 1);
    let indexes = useRoles ? roleFlags.filter(k => args[k] !== undefined).map(k => Number(args[k])) : Array.from({ length: dimensions }, (_, n) => n + 1).filter(n => n !== dim1);
    if (!useRoles && ['pie', 'pareto'].includes(kind)) indexes = indexes.slice(0, 1);
    if (args['dim2-indexes'] !== undefined) indexes = list(args['dim2-indexes']).map(Number);
    if (!Number.isInteger(dim1) || dim1 < 1 || dim1 > dimensions || !indexes.length || indexes.length > 50 || new Set(indexes).size !== indexes.length || indexes.some(n => !Number.isInteger(n) || n < 1 || n > dimensions || n === dim1)) chartInvalid('Chart indexes must be unique, in bounds, and distinct from the category dimension.');
    if (['pie', 'pareto'].includes(kind) && indexes.length !== 1) chartInvalid('This chart requires exactly one value series.');
    if (kind === 'combo' && indexes.length < 2) chartInvalid('Combo charts require at least two value series.');
    if (kind === 'bubble' && (indexes.length < 2 || indexes.length > 4)) chartInvalid('Bubble charts require two to four value indexes.');
    const basic: JsonObject = { chart_type: kind, data_range: refs.join(','), x_axis_numbers_as: args['x-axis-numbers-as'] ?? 'text' };
    if (!['text', 'values'].includes(String(basic.x_axis_numbers_as))) chartInvalid('x-axis-numbers-as must be text or values.');
    for (const flag of ['data-direction', 'header-range', 'dim1-index', 'key-index', ...roleFlags]) if (args[flag] !== undefined) basic[flag.replaceAll('-', '_')] = args[flag];
    if (args['dim2-indexes'] !== undefined) basic.dim2_indexes = indexes;
    for (const flag of ['series-types', 'series-y-axes']) if (args[flag] !== undefined) {
        const values = list(args[flag]), allowed = flag === 'series-types' ? ['column', 'line', 'area', 'scatter'] : ['left', 'right'];
        if (kind !== 'combo' || values.length !== indexes.length || values.some(v => !allowed.includes(v))) chartInvalid(`${flag} requires one valid value per combo series.`);
        basic[flag.replaceAll('-', '_')] = values;
    }
    return { basic, dim1, indexes, roles: useRoles ? roleFlags.filter(k => args[k] !== undefined).map(k => k.replace('-index', '')) : ['x', 'y', 'group', 'size'], refs, dimensionCount: dimensions };
}
export function chartInput(name: string, args: JsonObject, value: JsonObject): void {
    if (name === 'chart-create-basic') {
        if (!args['chart-type']) chartInvalid('chart-type is required.');
        const { basic } = chartData(args, String(args['chart-type'])); Object.assign(basic, chartConfig(args));
        if ((args['x-axis-min'] !== undefined || args['x-axis-max'] !== undefined) && basic.x_axis_numbers_as !== 'values') chartInvalid('X-axis bounds require x-axis-numbers-as values.');
        if (args['anchor-cell'] !== undefined) { const pos = anchor(args['anchor-cell']); basic.position = { row: pos.row, col: letter(pos.col) }; }
        if ((args.width !== undefined) !== (args.height !== undefined)) chartInvalid('width and height must be provided together.');
        if (args.width !== undefined) { if (Number(args.width) < 10 || Number(args.height) < 10) chartInvalid('width and height must be at least 10.'); basic.size = { width: args.width, height: args.height }; }
        value.operation = 'create'; value.basic_chart = basic;
    } else {
        if (!args['chart-id']) chartInvalid('chart-id is required.');
        if (name === 'chart-data-update') chartData(args, '');
        else if (!Object.keys(chartConfig(args)).length && args['last-point-label'] === undefined) chartInvalid('At least one chart configuration flag is required.');
        value.chart_id = args['chart-id']; value.operation = 'update';
    }
}

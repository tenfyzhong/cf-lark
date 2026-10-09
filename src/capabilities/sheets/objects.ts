import { normalizeConditionalFormat, normalizeChartColors, normalizePropertyEnums } from './property-normalization';
import { parseSheetJSON } from './json';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { SheetSpec } from './definitions';
import { propertyValidators } from './generated/properties';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function parsed(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    try { return parseSheetJSON(value); } catch { return invalid('Expected valid JSON; local file references are not available.'); }
}
export function objectInput(spec: SheetSpec, args: JsonObject, value: JsonObject): void {
    const action = spec.name.split('-').at(-1)!;
    value.operation = action;
    if (spec.filter && !value[spec.field!]) invalid(`${spec.filter} is required.`);
    if (spec.name === 'filter-delete' || spec.name === 'filter-update') value.filter_id = value.sheet_id || '<resolve-sheet-id>';
    if (action === 'delete') return;
    const raw = parsed(args.properties ?? (spec.name === 'filter-create' ? {} : undefined));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('properties must be a JSON object.');
    let props = (spec.name.startsWith('cond-format-') ? normalizeConditionalFormat(raw as JsonObject) : spec.name.startsWith('chart-') ? normalizeChartColors(raw) : structuredClone(raw)) as JsonObject;
    if (spec.name === 'pivot-create') {
        const id = typeof args['target-sheet-id'] === 'string' ? args['target-sheet-id'].trim() : '';
        const name = typeof args['target-sheet-name'] === 'string' ? args['target-sheet-name'].trim() : '';
        if (id && name) invalid('Target sheet selectors are mutually exclusive.');
        if (id) value.sheet_id = id;
        if (name) value.sheet_name = name;
        if (typeof args.source === 'string' && args.source.trim()) props.source = args.source.trim();
        const pos = typeof args['target-position'] === 'string' ? args['target-position'].trim() : '';
        const range = typeof args.range === 'string' ? args.range.trim() : '';
        if (pos && pos !== 'A1' && range) invalid('target-position and range are mutually exclusive.');
        if (pos && pos !== 'A1') props.range = pos;
        else if (range) props.range = range;
    }
    if (spec.name === 'filter-create' || spec.name === 'filter-update') {
        if (typeof args.range !== 'string' || !args.range.trim()) invalid('range is required.');
        props.range = args.range.trim();
        if (spec.name === 'filter-create' && !Object.hasOwn(props, 'rules')) props.rules = [];
    }
    if (spec.name.startsWith('cond-format-')) {
        if (typeof args['rule-type'] === 'string' && args['rule-type'].trim()) props.rule_type = args['rule-type'].trim();
        if (args.ranges !== undefined) {
            props.ranges = parsed(args.ranges);
            if (!Array.isArray(props.ranges)) invalid('ranges must be a JSON array.');
        }
        const required: Record<string, string[]> = { cellIs: ['compare_type', 'value'], containsText: ['compare_type', 'text'], timePeriod: ['operator', 'time_period'], dataBar: ['color', 'value_type'], colorScale: ['color', 'value_type'], rank: ['is_bottom', 'value_type'], aboveAverage: ['operator'], expression: ['formula'], iconSet: ['icon_type', 'value_type', 'operator'] };
        for (const entry of Array.isArray(props.attrs) ? props.attrs : []) {
            for (const field of required[String(props.rule_type)] ?? []) {
                if (!entry || entry[field] === undefined || entry[field] === null || (typeof entry[field] === 'string' && !entry[field].trim())) invalid(`Conditional-format attrs require ${field} for ${String(props.rule_type)}.`);
            }
        }
    }
    if (spec.name.startsWith('filter-view-')) {
        if (typeof args.range === 'string' && args.range.trim()) props.range = args.range.trim();
        if (typeof args['view-name'] === 'string' && args['view-name'].trim()) props.view_name = args['view-name'].trim();
    }
    if (spec.name === 'sparkline-update' && props.sparklines !== undefined) {
        if (!Array.isArray(props.sparklines) || props.sparklines.some(item => !item || typeof item.sparkline_id !== 'string' || !item.sparkline_id.trim())) invalid('Each updated sparkline requires sparkline_id.');
    }
    props = normalizePropertyEnums(spec.name, props);
    const validate = propertyValidators[spec.name as keyof typeof propertyValidators] as (((data: unknown) => boolean) & { errors?: unknown }) | undefined;
    if (validate && !validate(props)) invalid(`Invalid ${spec.name} properties: ${JSON.stringify(validate.errors)}`);
    value.properties = props;
}

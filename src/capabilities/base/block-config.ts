import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
export const charts = ['column', 'bar', 'line', 'pie', 'ring', 'scatter', 'funnel', 'wordCloud', 'area', 'combo', 'radar', 'statistics'];
export function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
export function object(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
const nonblank = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const lower = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
export function parse(value: unknown, name: string): JsonObject {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { invalid(`${name} must contain valid JSON.`); } }
    if (!object(value)) invalid(`${name} must be a JSON object.`);
    return structuredClone(value);
}
function check(ok: unknown, message: string): asserts ok { if (!ok) invalid(message); }
function keys(cfg: JsonObject, allowed: string[]) { for (const key of Object.keys(cfg)) check(allowed.includes(key), `Unsupported data configuration field: ${key}.`); }
function normalizeSort(value: unknown, defaultOrder: boolean) {
    if (!object(value)) return;
    for (const key of ['type', 'order']) if (typeof value[key] === 'string') value[key] = lower(value[key]);
    if (defaultOrder && !('order' in value) && ['group', 'view'].includes(String(value.type))) value.order = 'asc';
}
export function normalize(cfg: JsonObject): JsonObject {
    cfg = structuredClone(cfg);
    if (Array.isArray(cfg.series)) for (const series of cfg.series) if (object(series) && nonblank(series.rollup)) series.rollup = String(series.rollup).trim().toUpperCase();
    if (Array.isArray(cfg.group_by)) for (const group of cfg.group_by) if (object(group)) {
        if (typeof group.mode === 'string') group.mode = lower(group.mode);
        normalizeSort(group.sort, true);
    }
    return cfg;
}
export function normalizeApp(cfg: JsonObject): JsonObject {
    cfg = structuredClone(cfg);
    if (typeof cfg.data_source_mode === 'string') cfg.data_source_mode = lower(cfg.data_source_mode);
    normalizeSort(cfg.sort, false);
    if (Array.isArray(cfg.data_sources)) cfg.data_sources = cfg.data_sources.map(source => object(source) ? normalize(source) : source);
    return cfg;
}
const operators = ['is', 'isNot', 'contains', 'doesNotContain', 'isEmpty', 'isNotEmpty', 'isGreater', 'isGreaterEqual', 'isLess', 'isLessEqual'];
export function filter(cfg: JsonObject, strict: boolean, fieldID = false) {
    if (!('filter' in cfg)) return;
    const f = cfg.filter;
    if (!strict && !object(f)) return;
    check(object(f), 'filter must be an object.');
    const conjunction = strict ? f.conjunction : (typeof f.conjunction === 'string' ? lower(f.conjunction) || 'and' : '<nil>');
    check(conjunction === 'and' || conjunction === 'or', 'filter conjunction must be and or or.');
    if (!strict && !Array.isArray(f.conditions)) return;
    check(Array.isArray(f.conditions), 'filter conditions must be an array.');
    if (strict) check(f.conditions.length >= 1 && f.conditions.length <= 50, 'filter requires between 1 and 50 conditions.');
    for (const condition of f.conditions) {
        check(object(condition), 'Each filter condition must be an object.');
        check(nonblank(condition.field_name) || (fieldID && nonblank(condition.field_id)), 'Filter field_name is required.');
        const op = strict ? condition.operator : lower(condition.operator).replaceAll(' ', '');
        check((strict ? operators : operators.map(s => s.toLowerCase())).includes(String(op)), 'Unsupported filter operator.');
        check(['isEmpty', 'isNotEmpty', 'isempty', 'isnotempty'].includes(String(op)) || 'value' in condition, 'Filter condition requires a value.');
        if (strict && 'value' in condition) {
            const scalar = (value: unknown) => ['string', 'number', 'boolean'].includes(typeof value);
            check(scalar(condition.value) || (Array.isArray(condition.value) && condition.value.length <= 200 && condition.value.every(scalar)), 'Filter value must contain scalar values.');
        }
    }
}
export function numberFormat(cfg: JsonObject) {
    if (!('number_format' in cfg)) return;
    const f = cfg.number_format;
    check(object(f), 'number_format must be an object.');
    if ('formatName' in f) check(['digital', 'digital_without_separator', 'percentage_rounded', 'cyn_rounded', 'dollar_rounded'].includes(String(f.formatName)), 'Unsupported number format.');
    if ('precision' in f) check(typeof f.precision === 'number' && Number.isInteger(f.precision) && f.precision >= 0 && f.precision <= 9, 'Number precision must be between 0 and 9.');
}
function series(cfg: JsonObject, strict: boolean, ranking = false) {
    check(('series' in cfg) !== ('count_all' in cfg), 'Provide exactly one of series and count_all.');
    if ('count_all' in cfg && strict) check(cfg.count_all === true, 'count_all must be true.');
    if (!('series' in cfg)) return;
    check(Array.isArray(cfg.series) && cfg.series.length > 0 && (!strict || cfg.series.length <= 20) && (!ranking || cfg.series.length === 1), 'Invalid series count.');
    for (const item of cfg.series) {
        check(object(item) && nonblank(item.field_name), 'Each series requires field_name.');
        if (ranking) keys(item, ['field_name', 'rollup']);
        check(['SUM', 'MAX', 'MIN', 'AVERAGE'].includes(strict && !ranking ? String(item.rollup) : String(item.rollup ?? '').trim().toUpperCase()), 'Unsupported series rollup.');
    }
}
function groups(cfg: JsonObject, strict: boolean) {
    if (!('group_by' in cfg)) return;
    if (!strict && !Array.isArray(cfg.group_by)) return;
    check(Array.isArray(cfg.group_by) && cfg.group_by.length <= 2, 'group_by must have at most two items.');
    for (const group of cfg.group_by) {
        check(object(group) && nonblank(group.field_name), 'Each group requires field_name.');
        if (strict && 'mode' in group) check(['enumerated', 'integrated'].includes(String(group.mode)), 'Invalid group mode.');
        if (!('sort' in group)) continue;
        if (!strict && !object(group.sort)) continue;
        check(object(group.sort), 'Group sort must be an object.');
        check(['group', 'value', 'view'].includes(lower(group.sort.type)), 'Invalid group sort type.');
        if (!strict || 'order' in group.sort) check(['asc', 'desc'].includes(lower(group.sort.order)), 'Invalid group sort order.');
    }
}
export function dashboardConfig(type: string, cfg: JsonObject): JsonObject {
    const kind = lower(type);
    if (kind !== 'nps') cfg = normalize(cfg);
    if (kind === 'ranking') {
        if (!('limit_size' in cfg)) cfg.limit_size = 10;
        if (Array.isArray(cfg.group_by) && cfg.group_by.length === 1 && object(cfg.group_by[0]) && !('sort' in cfg.group_by[0])) cfg.group_by[0].sort = { type: 'value', order: 'desc' };
    }
    if (kind !== 'nps') check(!('category_range' in cfg), 'category_range is supported only for NPS.');
    if (kind === 'text') { check(nonblank(cfg.text), 'Text blocks require nonempty text.'); return cfg; }
    check(nonblank(cfg.table_name), 'table_name is required.');
    if (kind === 'nps') {
        for (const key of ['sort', 'limit_size', 'number_format', 'text', 'series']) check(!(key in cfg), `NPS does not support ${key}.`);
        if ('count_all' in cfg) check(cfg.count_all === true, 'count_all must be true.');
        check(Array.isArray(cfg.group_by) && cfg.group_by.length === 1 && object(cfg.group_by[0]), 'NPS requires exactly one group.');
        const group = cfg.group_by[0];
        check(nonblank(group.field_name) && (!('mode' in group) || group.mode === 'integrated') && !('sort' in group), 'Invalid NPS group.');
        if ('category_range' in cfg) check(Array.isArray(cfg.category_range) && cfg.category_range.length === 4, 'NPS category_range must have four elements.');
        filter(cfg, false); return cfg;
    }
    if (kind === 'ranking') {
        keys(cfg, ['table_name', 'series', 'count_all', 'group_by', 'filter', 'limit_size']);
        series(cfg, true, true);
        check(Array.isArray(cfg.group_by) && cfg.group_by.length === 1 && object(cfg.group_by[0]), 'Ranking requires exactly one group.');
        const group = cfg.group_by[0]; keys(group, ['field_name', 'mode', 'sort']);
        check(nonblank(group.field_name) && (!('mode' in group) || ['integrated', 'enumerated'].includes(String(group.mode))), 'Invalid ranking group.');
        check(object(group.sort), 'Ranking requires a sort.'); keys(group.sort, ['type', 'order']);
        check(group.sort.type === 'value' && ['asc', 'desc'].includes(String(group.sort.order)), 'Invalid ranking sort.');
        check(typeof cfg.limit_size === 'number' && Number.isInteger(cfg.limit_size) && cfg.limit_size >= 1 && cfg.limit_size <= 500, 'Ranking limit_size must be between 1 and 500.');
        if (object(cfg.filter)) { keys(cfg.filter, ['conjunction', 'conditions']); if (Array.isArray(cfg.filter.conditions)) for (const condition of cfg.filter.conditions) if (object(condition)) keys(condition, ['field_name', 'operator', 'value']); }
        filter(cfg, true); return cfg;
    }
    check(kind === 'statistics' || !('number_format' in cfg), 'number_format is supported only for statistics.');
    series(cfg, false); groups(cfg, false); filter(cfg, false); if (kind === 'statistics') numberFormat(cfg);
    return cfg;
}
export function appSource(cfg: JsonObject) {
    keys(cfg, ['table_name', 'series', 'count_all', 'group_by', 'filter']);
    check(nonblank(cfg.table_name), 'table_name is required.'); series(cfg, true); groups(cfg, true); filter(cfg, true);
}
export function appConfig(type: string, subType: string, cfg: JsonObject) {
    const kind = lower(type);
    if (kind === 'text') { keys(cfg, ['text']); if ('text' in cfg) check(typeof cfg.text === 'string', 'text must be a string.'); return; }
    if (kind === 'list') {
        keys(cfg, ['base_token', 'table_name', 'filter', 'sort_by', ...(['standard', 'grouped', 'collapsible'].includes(subType) ? ['columns', 'group_by'] : ['fields', subType === 'card' ? 'card_config' : 'detail_config'])]);
        check(nonblank(cfg.base_token) && nonblank(cfg.table_name), 'List base_token and table_name are required.');
        for (const key of ['columns', 'fields', 'group_by', 'sort_by']) if (key in cfg) check(Array.isArray(cfg[key]), `${key} must be an array.`);
        for (const key of ['filter', 'card_config', 'detail_config']) if (key in cfg) check(object(cfg[key]), `${key} must be an object.`);
        filter(cfg, true);
        for (const key of ['group_by', 'sort_by']) if (Array.isArray(cfg[key])) for (const item of cfg[key]) {
            check(object(item) && nonblank(item.field_name), `${key} requires field_name.`);
            if ('order' in item) check(['asc', 'desc'].includes(String(item.order)), 'Invalid list sort order.');
        }
        if (Array.isArray(cfg.columns)) for (const column of cfg.columns) {
            check(object(column), 'Each column must be an object.');
            check(column.type === 'field' ? nonblank(column.field_name) : column.type === 'combined' && Array.isArray(column.field_names) && column.field_names.length > 0 && column.field_names.every(v => typeof v === 'string'), 'Invalid list column.');
        }
        if (Array.isArray(cfg.fields)) check(cfg.fields.every(v => typeof v === 'string'), 'List fields must be strings.');
        for (const [key, names] of [['card_config', ['title_field_name', 'image_field_name']], ['detail_config', ['image_field_name']]] as const) if (object(cfg[key])) for (const name of names) if (name in cfg[key]) check(typeof cfg[key][name] === 'string', `${name} must be a string.`);
        return;
    }
    check(charts.some(value => lower(value) === kind), 'Unsupported app block type.');
    keys(cfg, ['base_token', 'data_sources', 'data_source_mode', 'sort']);
    check(nonblank(cfg.base_token), 'base_token is required.');
    if ('data_source_mode' in cfg) check(['aggregate', 'compare'].includes(lower(cfg.data_source_mode)), 'Invalid data_source_mode.');
    if ('sort' in cfg) {
        check(kind !== 'statistics' && object(cfg.sort), 'Invalid chart sort.');
        check(['group', 'value', 'record'].includes(lower(cfg.sort.type)), 'Invalid chart sort type.');
        if ('order' in cfg.sort) check(['asc', 'desc'].includes(lower(cfg.sort.order)), 'Invalid chart sort order.');
    }
    check(Array.isArray(cfg.data_sources) && cfg.data_sources.length > 0, 'data_sources must be a nonempty array.');
    for (const source of cfg.data_sources) { check(object(source), 'Each data source must be an object.'); appSource(source); if (kind === 'statistics' && Array.isArray(source.group_by)) check(source.group_by.length === 0, 'Statistics does not support grouping.'); }
}
export function appPatch(cfg: JsonObject) {
    const hasNull = (value: unknown): boolean => value === null || (typeof value === 'object' && Object.values(value as object).some(hasNull));
    check(!hasNull(cfg), 'App block updates do not accept null as a clearing marker.');
    keys(cfg, ['base_token', 'data_sources', 'data_source_mode', 'sort', 'table_name', 'filter', 'sort_by', 'columns', 'group_by', 'fields', 'card_config', 'detail_config', 'text']);
    cfg = normalizeApp(cfg);
    if ('data_sources' in cfg) {
        check(Array.isArray(cfg.data_sources) && cfg.data_sources.length > 0, 'data_sources must be a nonempty replacement array.');
        for (const source of cfg.data_sources) { check(object(source), 'Each data source must be an object.'); appSource(source); }
    }
    return cfg;
}

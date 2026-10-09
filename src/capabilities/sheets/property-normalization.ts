import { propertyEnums } from './generated/property-enums';
import { canonicalEnum } from './normalize';
import type { JsonObject } from '../../domain/models';
const compareTypes = ['equal', 'notEqual', 'greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual', 'between', 'notBetween', 'beginsWith', 'endsWith', 'containsText', 'notContains', 'is'];
const compareAliases: Record<string, string> = { '<': 'lessThan', '<=': 'lessThanOrEqual', '=<': 'lessThanOrEqual', '>': 'greaterThan', '>=': 'greaterThanOrEqual', '=>': 'greaterThanOrEqual', '=': 'equal', '==': 'equal', '!=': 'notEqual', '<>': 'notEqual', lt: 'lessThan', le: 'lessThanOrEqual', lte: 'lessThanOrEqual', gt: 'greaterThan', ge: 'greaterThanOrEqual', gte: 'greaterThanOrEqual', eq: 'equal', ne: 'notEqual', neq: 'notEqual', contains: 'containsText', greater: 'greaterThan', less: 'lessThan' };
const fontWords: Record<string, string> = { font_weight: 'bold', bold: 'bold', font_style: 'italic', italic: 'italic' };
function comparison(value: unknown): string | undefined { if (typeof value !== 'string') return; const key = value.toLowerCase().replace(/[^a-z0-9]/g, ''); return compareTypes.find(v => v.toLowerCase() === key) ?? compareAliases[value.trim().toLowerCase()]; }
function font(value: unknown): string | undefined {
    let words: unknown[];
    if (typeof value === 'string') words = value.toLowerCase().split(/[ ,+|\t]+/).filter(Boolean);
    else if (Array.isArray(value)) words = value.map(v => typeof v === 'string' ? v.trim().toLowerCase() : v);
    else if (value && typeof value === 'object') {
        if (Object.entries(value).some(([key, v]) => !fontWords[key.toLowerCase()] || typeof v !== 'boolean')) return;
        words = Object.entries(value).filter(([, v]) => v).map(([key]) => fontWords[key.toLowerCase()]);
    } else return;
    if (!words.length || words.some(v => v !== 'bold' && v !== 'italic')) return;
    return ['bold', 'italic'].filter(v => words.includes(v)).join(' ');
}
export function normalizeConditionalFormat(input: JsonObject): JsonObject {
    const props = structuredClone(input), style = props.style as JsonObject | undefined;
    if (style && typeof style === 'object' && !Array.isArray(style)) {
        const aliases: Record<string, string> = { background_color: 'back_color', bg_color: 'back_color', fill_color: 'back_color', font_color: 'fore_color', text_color: 'fore_color', color: 'fore_color' };
        for (const key of Object.keys(style).sort()) { const target = aliases[key]; if (target && style[target] === undefined && typeof style[key] === 'string' && String(style[key]).trim()) { style[target] = style[key]; delete style[key]; } }
        const composite = font(style.font); if (composite) style.font = composite;
        for (const key of Object.keys(style).sort()) {
            const word = fontWords[key]; if (!word) continue;
            if (style[key] === false) { delete style[key]; continue; }
            if (style[key] !== true && (typeof style[key] !== 'string' || String(style[key]).trim().toLowerCase() !== word)) continue;
            if (style.font === undefined || style.font === '') style.font = word;
            else if (['bold', 'italic', 'bold italic'].includes(String(style.font))) style.font = font(`${style.font} ${word}`);
            else continue;
            delete style[key];
        }
        if (typeof style.font_line === 'string' && style.text_decoration === undefined) {
            const line = style.font_line.trim().toLowerCase();
            if (['underline', 'line-through', 'strikethrough'].includes(line)) { style.text_decoration = line === 'underline' ? 'underline' : 'strikethrough'; delete style.font_line; }
        }
    }
    if (props.attrs && typeof props.attrs === 'object' && !Array.isArray(props.attrs)) props.attrs = [props.attrs];
    for (const entry of Array.isArray(props.attrs) ? props.attrs : []) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const shaped = ['time_period', 'icon_type', 'value_type', 'color'].some(key => Object.hasOwn(entry, key));
        if (entry.compare_type === undefined && !shaped) for (const key of ['operator', 'comparison', 'compare', 'criteria', 'condition']) {
            if (comparison(entry[key])) { entry.compare_type = entry[key]; delete entry[key]; break; }
        }
        const canonical = comparison(entry.compare_type); if (canonical) entry.compare_type = canonical;
        if (typeof entry.compare_type !== 'string' || shaped) continue;
        const scalar = (v: unknown) => typeof v === 'number' || typeof v === 'boolean';
        if (Array.isArray(entry.value) && ['between', 'notBetween'].includes(entry.compare_type) && entry.value.length === 2 && entry.value.every(scalar)) entry.value = entry.value.join(',');
        else if (scalar(entry.value)) entry.value = String(entry.value);
    }
    return props;
}
export function normalizeChartColors(value: unknown, color = false): unknown {
    if (typeof value === 'string') return color && /^(?:[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/.test(value) ? `#${value}` : value;
    if (Array.isArray(value)) return value.map(v => normalizeChartColors(v, color));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, normalizeChartColors(v, /^(?:color|Color)|(?:_color|Color|_colors|Colors)$/.test(key))]));
    return value;
}
export function normalizePropertyEnums(name: string, input: JsonObject): JsonObject {
    const props = structuredClone(input);
    for (const [path, allowed] of Object.entries(propertyEnums[name] ?? {})) {
        const visit = (node: unknown, keys: string[]): void => {
            if (!node || typeof node !== 'object') return;
            const [key, ...rest] = keys;
            if (key === '*' && Array.isArray(node)) { for (const item of node) visit(item, rest); return; }
            const object = node as JsonObject;
            if (!key || !Object.hasOwn(object, key)) return;
            if (rest.length) visit(object[key], rest);
            else if (typeof object[key] === 'string') object[key] = canonicalEnum(object[key], allowed) ?? object[key];
        };
        visit(props, path.split('/'));
    }
    return props;
}

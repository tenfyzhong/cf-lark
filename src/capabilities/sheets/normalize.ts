import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
const aliases: Record<string, string> = { font_name: 'font_family', horizontal_align: 'horizontal_alignment', halign: 'horizontal_alignment', vertical_align: 'vertical_alignment', valign: 'vertical_alignment', wrap_text: 'word_wrap', text_wrap: 'word_wrap', wrap_strategy: 'word_wrap', wrap: 'word_wrap', text_color: 'font_color' };
const enumAliases: Record<string, string> = { center: 'middle', centre: 'center', middle: 'center', merge_all: 'all', merge_rows: 'rows', merge_columns: 'columns', true: 'auto-wrap', false: 'overflow', wrap: 'auto-wrap', clip: 'word-clip', strikethrough: 'line-through', strike: 'line-through', line_through: 'line-through', linethrough: 'line-through', underlined: 'underline', col: 'column', cols: 'column', columns: 'column', rows: 'row', 'percentage,value': 'value_percentage', 'value,percentage': 'value_percentage' };
export function canonicalEnum(value: string, allowed: string[]): string | undefined { return allowed.find(v => v.toLowerCase() === value.toLowerCase()) ?? (allowed.includes(enumAliases[value.toLowerCase().replaceAll(' ', '')]!) ? enumAliases[value.toLowerCase().replaceAll(' ', '')] : undefined); }
const enums: Record<string, string[]> = { font_style: ['normal', 'italic'], font_weight: ['normal', 'bold'], font_line: ['none', 'underline', 'line-through'], horizontal_alignment: ['left', 'center', 'right'], vertical_alignment: ['top', 'middle', 'bottom'], word_wrap: ['overflow', 'auto-wrap', 'word-clip'] };
export function normalizeCellStyle(value: JsonObject): JsonObject {
    const style = structuredClone(value);
    for (const [alias, canonical] of Object.entries(aliases)) if (Object.hasOwn(style, alias)) { if (Object.hasOwn(style, canonical)) invalid(`Style ${alias} conflicts with ${canonical}.`); style[canonical] = style[alias]; delete style[alias]; }
    for (const [alias, canonical, on, off] of [['bold', 'font_weight', 'bold', 'normal'], ['font_bold', 'font_weight', 'bold', 'normal'], ['italic', 'font_style', 'italic', 'normal'], ['font_italic', 'font_style', 'italic', 'normal'], ['underline', 'font_line', 'underline', 'none'], ['font_underline', 'font_line', 'underline', 'none']] as string[][]) {
        if (!Object.hasOwn(style, alias!)) continue;
        const raw = String(style[alias!]).toLowerCase().trim();
        const normalized = ['true', '1', 'yes', on!, ...(on === 'underline' ? ['single', 'double', 'singleaccounting', 'doubleaccounting'] : [])].includes(raw) ? on : ['false', '0', 'no', 'none', off!].includes(raw) ? off : undefined;
        if (normalized === undefined) continue;
        if (Object.hasOwn(style, canonical!)) invalid(`Style ${alias} conflicts with ${canonical}.`);
        style[canonical!] = normalized; delete style[alias!];
    }
    if (Object.hasOwn(style, 'fore_color')) invalid('fore_color is ambiguous; choose font_color or background_color.');
    if (typeof style.word_wrap === 'boolean') style.word_wrap = style.word_wrap ? 'auto-wrap' : 'overflow';
    const fields = ['background_color', 'font_color', 'font_family', 'font_size', 'font_style', 'font_weight', 'font_line', 'horizontal_alignment', 'vertical_alignment', 'word_wrap', 'number_format'];
    for (const [key, raw] of Object.entries(style)) {
        if (!fields.includes(key)) invalid(`Unsupported cell style field ${key}.`);
        if (raw === null) continue;
        if (key === 'font_size' && typeof raw === 'string' && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw.trim()) && Number.isFinite(Number(raw))) style[key] = Number(raw);
        if (typeof style[key] !== (key === 'font_size' ? 'number' : 'string')) invalid(`Style ${key} has an invalid scalar type.`);
        if (enums[key] && style[key] !== '') { const canonical = canonicalEnum(String(style[key]), enums[key]!); if (!canonical) invalid(`Invalid ${key} value.`); style[key] = canonical; }
    }
    return style;
}
function object(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function scalarBorder(value: unknown): JsonObject {
    if (typeof value === 'number' && Number.isFinite(value)) return { style: 'solid', weight: value };
    if (typeof value !== 'string' || !value.trim()) invalid('Border shorthand requires a line style or thickness.');
    const word = value.trim(), weight = ['thin', 'medium', 'thick', 'hair'].includes(word.toLowerCase()) ? word.toLowerCase() === 'hair' ? 'thin' : word.toLowerCase() : undefined;
    return weight ? { style: 'solid', weight } : { style: word };
}
export function normalizeBorders(value: unknown): JsonObject {
    const borders = object(value) ? structuredClone(value) : { all: scalarBorder(value) };
    if (borders.outer !== undefined && (borders.all === undefined || JSON.stringify(borders.all) === JSON.stringify(borders.outer))) { borders.all ??= borders.outer; delete borders.outer; }
    if (borders.all !== undefined) { for (const side of ['top', 'bottom', 'left', 'right']) if (!Object.hasOwn(borders, side)) borders[side] = structuredClone(borders.all); delete borders.all; }
    for (const [key, raw] of Object.entries(borders)) {
        if (!['top', 'bottom', 'left', 'right'].includes(key) || !raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('Borders require top, bottom, left, or right side objects.');
        const side = raw as JsonObject;
        if (side.width !== undefined && side.weight === undefined) { side.weight = side.width; delete side.width; }
        if (side.type !== undefined && side.style === undefined) { side.style = side.type; delete side.type; }
        if (typeof side.weight === 'number' || (typeof side.weight === 'string' && side.weight.trim())) { const number = Number(side.weight); if (Number.isFinite(number) && number > 0) side.weight = number >= 3 ? 'thick' : number >= 2 ? 'medium' : 'thin'; }
        const weight = (raw: unknown): string | undefined => typeof raw === 'string' ? ({ thin: 'thin', medium: 'medium', thick: 'thick', hair: 'thin' } as Record<string, string>)[raw.toLowerCase()] : undefined;
        if (weight(side.weight)) side.weight = weight(side.weight);
        const styleWeight = weight(side.style);
        if (styleWeight && (side.weight === undefined || side.weight === styleWeight)) { side.weight = styleWeight; side.style = 'solid'; }
        for (const field of Object.keys(side)) if (!['style', 'weight', 'color'].includes(field)) invalid(`Unknown border field ${field}.`);
        if (side.style !== undefined) { const canonical = canonicalEnum(String(side.style), ['none', 'solid', 'dashed', 'dotted', 'double']); if (!canonical) invalid('Invalid border style.'); side.style = canonical; }
        if (side.weight !== undefined && !['thin', 'medium', 'thick'].includes(String(side.weight))) invalid('Invalid border weight.');
    }
    return borders;
}
export function foldBorderFamily(value: JsonObject): JsonObject {
    const input = structuredClone(value), sides = ['top', 'bottom', 'left', 'right', 'all'];
    const ensure = (): JsonObject => {
        if (input.border_styles === undefined) input.border_styles = {};
        if (!object(input.border_styles)) invalid('Border aliases conflict with a non-object border_styles value.');
        return input.border_styles;
    };
    const set = (side: string, attribute: string, value: unknown, from: string) => {
        const borders = ensure();
        if (borders[side] === undefined) borders[side] = {};
        if (!object(borders[side]) || Object.hasOwn(borders[side], attribute)) invalid(`${from} conflicts with border_styles.${side}.${attribute}.`);
        (borders[side] as JsonObject)[attribute] = value;
    };
    const loose = (side: string, value: unknown, from: string) => {
        const normalized = normalizeBorders({ top: object(value) ? value : scalarBorder(value) }).top as JsonObject;
        for (const attribute of Object.keys(normalized).sort()) set(side, attribute, normalized[attribute], from);
    };
    const all = (attribute: string, value: unknown, from: string) => {
        if (attribute === 'style' && typeof value === 'string' && ['thin', 'medium', 'thick', 'hair'].includes(value.toLowerCase())) {
            const spec = scalarBorder(value); set('all', 'weight', spec.weight, from); set('all', 'style', 'solid', from);
        } else set('all', attribute, value, from);
    };
    for (const key of ['borders', 'border']) if (Object.hasOwn(input, key)) {
        const value = input[key];
        if (object(value) && Object.keys(value).some(key => sides.includes(key))) {
            for (const side of Object.keys(value).sort()) { if (!sides.includes(side)) invalid(`Invalid border side ${side}.`); loose(side, value[side], key); }
        } else loose('all', value, key);
        delete input[key];
    }
    for (const side of sides) {
        for (const key of [`border_${side}`, `${side}_border`]) if (Object.hasOwn(input, key)) { loose(side, input[key], key); delete input[key]; }
        for (const attr of ['color', 'style', 'weight', 'width']) for (const key of [`border_${side}_${attr}`, `${side}_border_${attr}`]) if (Object.hasOwn(input, key)) { set(side, attr === 'width' ? 'weight' : attr, input[key], key); delete input[key]; }
    }
    for (const attr of ['color', 'style', 'weight', 'width']) {
        const key = `border_${attr}`;
        if (Object.hasOwn(input, key)) { all(attr === 'width' ? 'weight' : attr, input[key], key); delete input[key]; }
    }
    if (Object.hasOwn(input, 'border_type')) {
        const value = input.border_type, word = typeof value === 'string' ? value.trim().toUpperCase().replaceAll(/[- ]/g, '_') : '';
        const selectors: Record<string, string> = { FULL_BORDER: 'all', ALL_BORDER: 'all', ALL_BORDERS: 'all', ALL: 'all', GRID: 'all', TOP_BORDER: 'top', BOTTOM_BORDER: 'bottom', LEFT_BORDER: 'left', RIGHT_BORDER: 'right' };
        const side = selectors[word];
        if (side) {
            const borders = ensure();
            if (side !== 'all' && object(borders.all)) { borders[side] = { ...borders.all, ...(object(borders[side]) ? borders[side] : {}) }; delete borders.all; }
            if (borders[side] === undefined) borders[side] = {};
            if (object(borders[side]) && !Object.hasOwn(borders[side], 'style')) (borders[side] as JsonObject).style = 'solid';
        } else if (word === 'NO_BORDER' || word === 'NONE') set('all', 'style', 'none', 'border_type');
        else if (['OUTER_BORDER', 'INNER_BORDER', 'HORIZONTAL_BORDER', 'VERTICAL_BORDER'].includes(word)) invalid(`${word} cannot be expressed by a uniform cell border; use explicit edge ranges.`);
        else loose('all', value, 'border_type');
        delete input.border_type;
    }
    return input;
}
export function normalizeTypedCell(value: JsonObject): JsonObject {
    const cell = foldBorderFamily(value);
    if (cell.style && typeof cell.style === 'object') { if (cell.cell_styles !== undefined) invalid('style conflicts with cell_styles.'); cell.cell_styles = cell.style; delete cell.style; }
    for (const field of Object.keys(cell).sort()) {
        const canonical = aliases[field] ?? field;
        if (!['background_color', 'font_color', 'font_family', 'font_size', 'font_style', 'font_weight', 'font_line', 'horizontal_alignment', 'vertical_alignment', 'word_wrap', 'number_format'].includes(canonical)) continue;
        const style = (cell.cell_styles ?? {}) as JsonObject;
        if (!style || typeof style !== 'object' || Array.isArray(style)) invalid('cell_styles must be an object.');
        if (Object.hasOwn(style, canonical)) invalid(`Cell style ${field} conflicts with cell_styles.${canonical}.`);
        style[canonical] = cell[field]; cell.cell_styles = style; delete cell[field];
    }
    if (cell.type !== undefined) invalid('Cell type is inferred from its JSON value; use number_format for display.');
    if (cell.cell_styles && typeof cell.cell_styles === 'object') {
        const style = foldBorderFamily(cell.cell_styles as JsonObject);
        if (style.border_styles !== undefined) { if (cell.border_styles !== undefined) invalid('Nested border_styles conflicts with cell border_styles.'); cell.border_styles = style.border_styles; delete style.border_styles; }
        if (Object.keys(style).length) cell.cell_styles = normalizeCellStyle(style); else delete cell.cell_styles;
    }
    if (cell.border_styles !== undefined) cell.border_styles = normalizeBorders(cell.border_styles);
    return cell;
}

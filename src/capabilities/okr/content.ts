import { ServiceError } from '../../domain/errors';
export type Data = Record<string, any>;
export function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
export function parse(value: unknown): Data {
    let result = value;
    if (typeof value === 'string') { try { result = JSON.parse(value); } catch { invalid('Expected a single valid JSON object.'); } }
    if (!result || typeof result !== 'object' || Array.isArray(result)) invalid('Expected a JSON object.');
    return result as Data;
}
export function id(value: unknown): string {
    if (typeof value !== 'string' || !/^\d+$/.test(value) || BigInt(value) <= 0n || BigInt(value) > 9223372036854775807n) invalid('ID must be a positive signed 64-bit integer string.');
    return value;
}
export function choice(value: unknown, allowed: string[], fallback?: string): string {
    const text = String(value ?? fallback ?? ''); if (!allowed.includes(text)) invalid(`Expected one of: ${allowed.join(', ')}.`); return text;
}
export function content(value: unknown, style = 'simple', strict = false): Data {
    const data = parse(value);
    if (strict) validateContent(data, style);
    if (style === 'richtext') {
        if (data.blocks !== undefined && !Array.isArray(data.blocks)) invalid('Content blocks must be an array.');
        return data;
    }
    if (typeof data.text !== 'string' || !data.text.trim()) invalid('Simple content requires nonblank text.');
    if (data.mention !== undefined && (!Array.isArray(data.mention) || data.mention.some((item: unknown) => typeof item !== 'string' || !item.trim()))) invalid('Mentions must contain nonblank user IDs.');
    if (data.docs?.length || data.images?.length) invalid('Use richtext for document links and images.');
    const text = data.text.replace(/@\{[^}]*\}/g, ' ').replace(/ +/g, ' ').trim();
    return { blocks: [{ block_element_type: 'paragraph', paragraph: { elements: [
        ...(text ? [{ paragraph_element_type: 'textRun', text_run: { text } }] : []),
        ...(data.mention ?? []).map((user: string) => ({ paragraph_element_type: 'mention', mention: { user_id: user } })),
    ] } }] };
}
export function simple(data: Data): Data {
    const output: Data = { text: '' }, mentions: string[] = [], docs: Data[] = [], images: string[] = [];
    for (const block of data.blocks ?? []) {
        for (const element of block.paragraph?.elements ?? []) {
            if (element.text_run?.text !== undefined) output.text += element.text_run.text;
            else if (element.mention?.user_id !== undefined) { const user = element.mention.user_id; output.text += ` @{${user}} `; mentions.push(user); }
            else if (element.docs_link) docs.push({ title: element.docs_link.title ?? '', url: element.docs_link.url ?? '' });
        }
        for (const item of block.gallery?.images ?? []) if (item.src !== undefined) images.push(item.src);
    }
    if (mentions.length) output.mention = mentions; if (docs.length) output.docs = docs; if (images.length) output.images = images;
    return output;
}
const v1Keys: Record<string, string> = { block_element_type: 'type', paragraph_element_type: 'type', text_run: 'textRun', docs_link: 'docsLink', mention: 'person', user_id: 'openId', list_type: 'type', indent_level: 'indentLevel', strike_through: 'strikeThrough', back_color: 'backColor', text_color: 'textColor', images: 'imageList', file_token: 'fileToken' };
export function toV1(value: any): any {
    if (Array.isArray(value)) return value.map(toV1);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [v1Keys[key] ?? key, key === 'paragraph_element_type' && child === 'mention' ? 'person' : toV1(child)]));
}
export function toV2(data: Data): Data {
    const reverse: Record<string, string> = Object.fromEntries(Object.entries(v1Keys).filter(([key]) => !['block_element_type', 'paragraph_element_type', 'list_type'].includes(key)).map(([key, value]) => [value, key]));
    function convert(value: any, parent = ''): any {
        if (Array.isArray(value)) return value.map(item => convert(item, parent));
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).map(([key, child]) => {
            const target = key === 'type' ? parent === 'blocks' ? 'block_element_type' : parent === 'elements' ? 'paragraph_element_type' : 'list_type' : reverse[key] ?? key;
            return [target, target === 'paragraph_element_type' && child === 'person' ? 'mention' : convert(child, key)];
        }));
    }
    return convert(data);
}
export function time(value: unknown): string {
    const text = String(value ?? ''); if (!/^-?\d+$/.test(text)) return text;
    const date = new Date(Number(text)); return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 19).replace('T', ' ') : text;
}
export function progress(data: Data, style: string, v2 = false): Data {
    const output: Data = { id: data[v2 ? 'id' : 'progress_id'] ?? '', modify_time: time(data[v2 ? 'update_time' : 'modify_time']) };
    if (v2) output.create_time = time(data.create_time);
    if (data.progress_rate) {
        const rate = data.progress_rate, percent = rate[v2 ? 'progress_percent' : 'percent'], status = rate[v2 ? 'progress_status' : 'status'];
        output.progress_rate = { ...(percent !== undefined ? { percent } : {}), ...([0, 1, 2].includes(status) ? { status: ['normal', 'overdue', 'done'][status] } : {}) };
    }
    if (data.content?.blocks?.length) { const block = v2 ? data.content : toV2(data.content); output.content = style === 'simple' ? simple(block) : JSON.stringify(block); }
    return output;
}
export function comment(data: Data, style: string): Data {
    const result: Data = { ...data, create_time: time(data.create_time), update_time: time(data.update_time) };
    if (data.solved_time !== undefined) result.solved_time = time(data.solved_time);
    if (data.content) result.content = style === 'simple' ? simple(data.content) : data.content;
    return result;
}
export function threads(items: Data[], style: string): Data[][] {
    const groups = new Map<string, Data[]>();
    for (const item of items) { const key = item.selection?.id ? `selection:${item.selection.id}` : `comment:${item.id}`; groups.set(key, [...(groups.get(key) ?? []), item]); }
    const compare = (a: Data, b: Data) => String(a.create_time ?? '').localeCompare(String(b.create_time ?? '')) || String(a.id).localeCompare(String(b.id));
    return [...groups.values()].map(group => group.sort(compare)).sort((a, b) => compare(a[0]!, b[0]!)).map(group => group.map(item => comment(item, style)));
}

function validateContent(data: Data, style: string): void {
    if (style === 'simple') {
        if (Object.keys(data).some(key => !['text', 'mention', 'docs', 'images'].includes(key))) invalid('Unknown simple content field.');
        return;
    }
    const schemas: Record<string, Record<string, string>> = {
        root: { blocks: 'block[]' }, block: { block_element_type: 'string', paragraph: 'paragraph', gallery: 'gallery' },
        paragraph: { style: 'paragraphStyle', elements: 'element[]' }, paragraphStyle: { list: 'list' }, list: { list_type: 'string', indent_level: 'number', number: 'number' },
        element: { paragraph_element_type: 'string', text_run: 'textRun', docs_link: 'docs', mention: 'mention' },
        textRun: { text: 'string', style: 'textStyle' }, textStyle: { bold: 'boolean', strike_through: 'boolean', back_color: 'color', text_color: 'color', link: 'link' },
        docs: { url: 'string', title: 'string' }, mention: { user_id: 'string' }, link: { url: 'string' },
        color: { red: 'number', green: 'number', blue: 'number', alpha: 'number' }, gallery: { images: 'image[]' }, image: { file_token: 'string', src: 'string', width: 'number', height: 'number' },
    };
    function validate(value: any, schema: string): void {
        if (value === null) return;
        if (schema.endsWith('[]')) { if (!Array.isArray(value)) invalid('Expected content array.'); value.forEach(item => validate(item, schema.slice(0, -2))); return; }
        if (['string', 'number', 'boolean'].includes(schema)) { if (typeof value !== schema) invalid('Invalid content field type.'); return; }
        if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected content object.');
        for (const [key, item] of Object.entries(value)) { const child = schemas[schema]![key]; if (!child) invalid(`Unknown content field: ${key}.`); validate(item, child); }
    }
    validate(data, 'root');
    if (!data.blocks?.length || !data.blocks.some((block: Data) => block?.paragraph?.elements?.length || block?.gallery?.images?.length)) invalid('Create content must contain a nonempty paragraph or gallery.');
}

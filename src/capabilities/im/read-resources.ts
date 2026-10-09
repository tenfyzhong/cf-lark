import type { JsonObject } from '../../domain/models';
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export function resourceRefs(raw: JsonObject, owner?: string): JsonObject[] {
    const messageID = owner ?? String(raw.message_id ?? '');
    let body: JsonObject; try { body = object(JSON.parse(String(object(raw.body).content ?? '{}'))); } catch { return []; }
    const refs: JsonObject[] = [];
    const add = (key: unknown, type: string): void => { if (typeof key === 'string' && key) refs.push({ message_id: messageID, key, type }); };
    if (raw.msg_type === 'image') add(body.image_key, 'image');
    else if (['file', 'audio', 'video', 'media'].includes(String(raw.msg_type))) add(body.file_key, 'file');
    else if (raw.msg_type === 'post') {
        for (const item of list(body.files).map(object)) if (!item.is_folder) add(item.file_key, 'file');
        const locale = ['zh_cn', 'en_us', 'ja_jp', ...Object.keys(body).sort()].find((key) => body[key] && typeof body[key] === 'object' && !Array.isArray(body[key]));
        const post = 'content' in body || 'title' in body ? body : object(locale ? body[locale] : undefined);
        for (const element of list(post.content).flatMap(list).map(object)) if (element.tag === 'img') add(element.image_key, 'image'); else if (element.tag === 'media') add(element.file_key, 'file');
    }
    return refs;
}
export function attachResourceRefs(messages: JsonObject[], raw: JsonObject[], merged: JsonObject[]): JsonObject[] {
    const tasks = new Map<string, JsonObject>();
    const nodes = messages.flatMap((message) => [message, ...list(message.thread_replies).map(object)]);
    for (const message of nodes) {
        const source = raw.find((item) => item.message_id === message.message_id);
        if (!source) continue;
        const refs = source.msg_type === 'merge_forward' ? merged.filter((item) => item._container === source.message_id).flatMap((item) => resourceRefs(item, String(source.message_id))) : resourceRefs(source);
        if (!refs.length) continue;
        message.resources = refs;
        for (const ref of refs) tasks.set(`${ref.message_id}:${ref.key}`, ref);
    }
    return [...tasks.values()];
}
export function applyResourceResult(messages: JsonObject[], ref: JsonObject, result: JsonObject): void {
    for (const message of messages.flatMap((item) => [item, ...list(item.thread_replies).map(object)])) for (const resource of list(message.resources).map(object)) if (resource.message_id === ref.message_id && resource.key === ref.key) Object.assign(resource, result);
}
export function conciseMarkdown(messages: JsonObject[], container: unknown, hasMore: unknown, token: unknown): string {
    const safe = (value: unknown): string => String(value ?? '').replace(/[\\`*_\[\]<>#~]/gu, '\\$&');
    const render = (message: JsonObject, depth = 0): string => {
        const sender = object(message.sender), label = sender.name || sender.id || 'unknown';
        const title = `${'  '.repeat(depth)}- **${safe(label)}** (${safe(message.create_time)}) [${safe(message.message_id)}]`;
        return `${title}\n${String(message.content ?? '').split('\n').map((line) => `${'  '.repeat(depth + 1)}${line}`).join('\n')}${list(message.thread_replies).map(object).map((reply) => `\n${render(reply, depth + 1)}`).join('')}`;
    };
    return `# Messages${container ? `: ${safe(container)}` : ''}\n\n${messages.map((message) => render(message)).join('\n\n')}${hasMore ? `\n\nMore messages available. Cursor: ${safe(token)}` : ''}`;
}

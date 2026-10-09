import { prepareCards, type ImCardFormatter } from './card';
import type { JsonObject } from '../../domain/models';
import type { CommandContext } from '../../ports/capabilities';
import { formatEventMessage, resolveSenderNames } from './format';
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const objects = (value: unknown): JsonObject[] => Array.isArray(value) ? value.map(object) : [];
const escape = (value: unknown): string => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function expansionTasks(raw: JsonObject[]): JsonObject[] {
    const tasks: JsonObject[] = [];
    const seen = new Set<string>();
    for (const message of raw) {
        if (message.msg_type === 'merge_forward') { const key = `merge:${message.message_id}`; if (!seen.has(key)) { tasks.push({ kind: 'merge', messageID: message.message_id }); seen.add(key); } continue; }
        let body: JsonObject; try { body = object(JSON.parse(String(object(message.body).content ?? '{}'))); } catch { continue; }
        const folders = message.msg_type === 'folder' ? [body] : message.msg_type === 'post' ? objects(body.files).filter((file) => file.is_folder) : [];
        for (const folder of folders) if (folder.file_key) {
            const key = `${message.message_id}:${folder.file_key}`;
            if (!seen.has(key)) { tasks.push({ kind: 'folder', messageID: message.message_id, key: folder.file_key, name: folder.file_name ?? '', post: message.msg_type === 'post' }); seen.add(key); }
        }
    }
    return tasks;
}
function renderForward(items: JsonObject[], root: string): string {
    const grouped = new Map<string, JsonObject[]>();
    for (const item of items) {
        if (item.message_id === root && !item.upper_message_id) continue;
        const parent = String(item.upper_message_id || root);
        grouped.set(parent, [...grouped.get(parent) ?? [], item]);
    }
    for (const children of grouped.values()) children.sort((a, b) => Number(a.create_time) - Number(b.create_time));
    function render(parent: string, seen: Set<string>): string {
        if (seen.has(parent) || seen.size > 100) return '<forwarded_messages/>';
        const path = new Set(seen); path.add(parent);
        const parts = (grouped.get(parent) ?? []).map((item) => {
            const sender = object(item.sender), name = sender.sender_name || sender.name || sender.id || 'unknown';
            const number = Number(item.create_time), date = new Date(number > 1e12 ? number : number * 1000);
            const time = Number.isFinite(number) && number && !Number.isNaN(date.valueOf()) ? date.toISOString().replace('.000Z', 'Z') : 'unknown';
            const content = item.msg_type === 'merge_forward' && item.message_id ? render(String(item.message_id), path) : String(item._rendered_content ?? formatEventMessage(item));
            return `[${time}] ${name}:\n${content.split('\n').map((line) => `    ${line}`).join('\n')}`;
        });
        return parts.length ? `<forwarded_messages>\n${parts.join('\n')}\n</forwarded_messages>` : '<forwarded_messages/>';
    }
    return render(root, new Set());
}
export async function expandMessage(task: JsonObject, context: CommandContext, cardFormatter?: ImCardFormatter, nameCache: JsonObject = {}): Promise<{ content: string; raw?: JsonObject[] }> {
    if (task.kind === 'merge') {
        const data = await context.lark.request({ method: 'GET', path: `/open-apis/im/v1/messages/${encodeURIComponent(String(task.messageID))}`, query: { user_id_type: 'open_id', card_msg_content_type: 'raw_card_content', with_sender_name: true } });
        const raw = await prepareCards(resolveSenderNames(objects(data.items), nameCache), cardFormatter);
        return { content: renderForward(raw, String(task.messageID)), raw };
    }
    const data = await context.lark.request({ method: 'GET', path: `/open-apis/im/v1/files/${encodeURIComponent(String(task.key))}/folder`, query: { srctype: 'message', srcid: task.messageID, recursive: 'false' } });
    const items = objects(data.items), count = Number(data.all_count ?? 0), shown = items.slice(0, 10), hasMore = items.length > 10 || count > items.length;
    const opening = `<folder key="${escape(task.key)}"${task.name ? ` name="${escape(task.name)}"` : ''} child_count="${count}"${hasMore ? ' has_more="true"' : ''}`;
    if (!shown.length) return { content: `${opening}/>` };
    const children = shown.map((item) => `<${item.is_folder ? 'folder' : 'file'} key="${escape(item.file_key)}" name="${escape(item.name)}"${item.is_folder && Number(item.children_count) > 0 ? ` child_count="${item.children_count}"` : ''}/>`).join('');
    return { content: `${opening}>${children}</folder>` };
}
export function applyExpansion(messages: JsonObject[], task: JsonObject, content: string): void {
    for (const message of messages.flatMap((item) => [item, ...objects(item.thread_replies)])) if (message.message_id === task.messageID) {
        if (!task.post) message.content = content;
        else {
            const key = escape(task.key).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
            message.content = String(message.content).replace(new RegExp(`<folder key="${key}"[^>]*\\/>`, 'u'), content);
        }
    }
}

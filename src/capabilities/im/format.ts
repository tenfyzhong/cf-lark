import type { JsonObject } from '../../domain/models';
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const escape = (value: unknown): string => string(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function style(value: string, styles: unknown): string {
    if (!value) return value;
    const selected = list(styles);
    for (const [key, before, after] of [['bold', '**', '**'], ['italic', '*', '*'], ['underline', '<u>', '</u>'], ['lineThrough', '~~', '~~']]) if (selected.includes(key)) value = before + value + after;
    return value;
}
function element(raw: unknown): string {
    const item = object(raw), text = string(item.text), key = string(item.image_key);
    switch (item.tag) {
        case 'text': return style(text, item.style);
        case 'md': return text;
        case 'a': { const href = string(item.href); return style(href && text ? `[${text.replaceAll('[', '\\[').replaceAll(']', '\\]')}](${href})` : href || text, item.style); }
        case 'at': { const id = string(item.user_id), name = string(item.user_name); return style(['@_all', 'all'].includes(id) ? '<at user_id="all"></at>' : name ? id.startsWith('ou') ? `<at user_id="${id}">${name}</at>` : `@${name}` : `@${id}`, item.style); }
        case 'emotion': return item.emoji_type ? `:${item.emoji_type}:` : '';
        case 'img': return key ? `![Image](${key})` : '[Image]';
        case 'media': return item.file_key ? `[Media: ${item.file_key}]` : '[Media]';
        case 'code_block': return `\n\`\`\`${string(item.language)}\n${text}\n\`\`\`\n`;
        case 'hr': return '\n---\n';
        default: return text;
    }
}
function post(data: JsonObject): string {
    const locale = ['zh_cn', 'en_us', 'ja_jp', ...Object.keys(data).sort()].find((key) => data[key] && typeof data[key] === 'object' && !Array.isArray(data[key]));
    const body = 'content' in data || 'title' in data ? data : object(locale ? data[locale] : undefined);
    const blocks = list(body.content_v2).length ? list(body.content_v2) : list(body.content);
    const parts = [...(body.title ? [String(body.title)] : []), ...blocks.map((block) => list(block).map(element).join(''))];
    let result = parts.join('\n').trim() || '[Rich text message]';
    for (const raw of list(data.files)) {
        const file = object(raw);
        if (file.file_key) result += `\n<${file.is_folder ? 'folder' : 'file'} key="${escape(file.file_key)}"${file.file_name ? ` name="${escape(file.file_name)}"` : ''}/>`;
    }
    return result;
}
export function formatEventMessage(message: JsonObject): string {
    const type = string(message.message_type ?? message.msg_type), raw = string(message.content ?? object(message.body).content);
    if (!raw) return '';
    if (type === 'merge_forward') {
        try { const parsed = object(JSON.parse(raw)); const ids = list(parsed.create_message_ids).filter((item) => typeof item === 'string'); return ids.length ? `[Merged forward: ${ids.length} messages]` : '[Merged forward]'; } catch { return '[Merged forward]'; }
    }
    if (type === 'sticker') return '[Sticker]';
    if (type === 'video_chat') return '[Video call]';
    let data: JsonObject;
    try { const parsed: unknown = JSON.parse(raw); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Object required'); data = parsed as JsonObject; }
    catch { return `[Invalid ${type === 'post' ? 'rich text' : type === 'media' ? 'video' : type === 'share_chat' ? 'chat card' : type === 'share_user' ? 'user card' : type === 'system' ? 'system message' : type} JSON]`; }
    const file = string(data.file_key), image = string(data.image_key), name = string(data.file_name) || file;
    const duration = typeof data.duration === 'number' && data.duration > 0 ? `${Math.round(data.duration / 1000)}s` : '';
    let result: string;
    switch (type) {
        case 'text': result = string(data.text) || raw; break;
        case 'post': result = post(data); break;
        case 'image': result = image ? `[Image: ${image}]` : '[Image]'; break;
        case 'file': result = file ? `<file key="${escape(file)}" name="${escape(name)}"/>` : '[File]'; break;
        case 'folder': result = file ? `<folder key="${escape(file)}"${data.file_name ? ` name="${escape(data.file_name)}"` : ''}/>` : '[Folder]'; break;
        case 'audio': result = file ? `<audio key="${escape(file)}"${duration ? ` duration="${duration}"` : ''}/>` : duration ? `[Voice: ${duration}]` : '[Voice]'; break;
        case 'media': case 'video': result = file ? `<video key="${escape(file)}" name="${escape(name)}"${duration ? ` duration="${duration}"` : ''}${image ? ` cover_image_key="${escape(image)}"` : ''}/>` : '[Video]'; break;
        case 'share_chat': result = data.chat_id ? `[Chat card: ${data.chat_id}]` : '[Chat card]'; break;
        case 'share_user': result = data.user_id ? `[User card: ${data.user_id}]` : '[User card]'; break;
        case 'location': result = data.name ? `[Location: ${data.name}]` : '[Location]'; break;
        case 'share_calendar_event': case 'calendar': case 'general_calendar': {
            const tag = type === 'share_calendar_event' ? 'calendar_share' : type === 'calendar' ? 'calendar_invite' : 'calendar';
            const attrs = ['open_calendar_id', 'open_event_id', 'share_token'].filter((key) => data[key]).map((key) => ` ${key}="${escape(data[key])}"`).join('');
            const start = timestamp(data.start_time), end = timestamp(data.end_time);
            const body = [string(data.summary), start ? start + (end ? ` ~ ${end}` : '') : ''].filter(Boolean).join('\n') || tag;
            result = `<${tag}${attrs}>\n${escapeBody(body)}\n</${tag}>`; break;
        }
        case 'todo': {
            const summary = object(data.summary);
            const content = list(summary.content).map((block) => list(block).map(element).join('')).join('\n');
            const due = timestamp(data.due_time);
            const body = [string(summary.title), content, due ? `Due: ${due}` : ''].filter(Boolean).join('\n') || 'todo';
            result = `<todo${data.task_id ? ` task_id="${escape(data.task_id)}"` : ''}>\n${escapeBody(body)}\n</todo>`; break;
        }
        case 'vote': {
            const body = [string(data.topic), ...list(data.options).filter((item) => typeof item === 'string' && item).map((item) => `• ${item}`), ...(typeof data.status === 'number' && data.status !== 0 ? ['(Closed)'] : [])].filter(Boolean).join('\n') || 'vote';
            result = `<vote>\n${escapeBody(body)}\n</vote>`; break;
        }
        case 'system': {
            result = string(data.template);
            if (!result) { result = '[System message]'; break; }
            for (const key of ['from_user', 'to_chatters']) result = result.replaceAll(`{${key}}`, list(data[key]).filter((item) => typeof item === 'string' && item).join(', '));
            result = result.replaceAll('{divider_text}', string(object(data.divider_text).text)).replace(/\{([^{}]+)\}/gu, (match, key: string) => string(data[key]) || match).trim(); break;
        }
        case 'hongbao': result = data.text ? `<hongbao text=${JSON.stringify(data.text)}/>` : '<hongbao/>'; break;
        default: result = `[${type}]`;
    }
    for (const mention of list(message.mentions).map(object)) if (mention.key && mention.name) result = result.replaceAll(String(mention.key), `@${mention.name}`);
    return result;
}

const escapeBody = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function timestamp(value: unknown): string {
    if (typeof value !== 'string' || !/^[+-]?\d+$/u.test(value) || Number(value) === 0) return '';
    const date = new Date(Number(value) * (value.replace(/^[+-]/u, '').length >= 13 ? 1 : 1000));
    return Number.isNaN(date.valueOf()) ? '' : date.toISOString().slice(0, 19).replace('T', ' ');
}

export function formatApiMessage(raw: JsonObject, brand?: 'lark' | 'feishu'): JsonObject {
    const sender = { ...object(raw.sender) };
    if (sender.sender_name) sender.name = sender.sender_name;
    delete sender.sender_name;
    const time = (value: unknown): string => {
        const numeric = Number(value), original = value === undefined || value === null ? '' : String(value);
        if (!Number.isFinite(numeric) || !numeric) return original;
        const date = new Date(numeric > 1e12 ? numeric : numeric * 1000);
        return Number.isNaN(date.valueOf()) ? original : date.toISOString().slice(0, 16).replace('T', ' ');
    };
    const output: JsonObject = { message_id: raw.message_id ?? '', msg_type: raw.msg_type ?? '', content: raw._rendered_content ?? formatEventMessage(raw), sender: raw.sender === undefined ? null : sender, create_time: time(raw.create_time), deleted: Boolean(raw.deleted), updated: Boolean(raw.updated) };
    for (const key of ['chat_id', 'message_position', 'thread_message_position']) if (raw[key] !== undefined) output[key] = raw[key];
    if (raw.thread_id) output.thread_id = raw.thread_id; else if (raw.parent_id) output.reply_to = raw.parent_id;
    if (raw.updated && raw.update_time !== undefined && String(raw.update_time).trim()) output.update_time = time(raw.update_time);
    if (Array.isArray(raw.mentions) && raw.mentions.length) output.mentions = raw.mentions.map(object).map((item) => ({ key: item.key ?? '', name: item.name ?? '', id: typeof item.id === 'string' ? item.id : object(item.id).open_id ?? '' }));
    if (typeof raw.message_app_link === 'string' && raw.message_app_link.trim()) output.message_app_link = raw.message_app_link.trim();
    else if (brand && raw.chat_id) {
        const position = (value: unknown): string | undefined => typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? String(Number(value)) : undefined;
        const normal = position(raw.message_position), thread = position(raw.thread_message_position);
        const url = new URL(`https://applink.${brand === 'lark' ? 'larksuite.com' : 'feishu.cn'}/client/${raw.thread_id && thread !== undefined ? 'thread' : 'chat'}/open`);
        if (raw.thread_id && thread !== undefined) for (const [key, value] of Object.entries({ open_chat_id: raw.chat_id, open_thread_id: raw.thread_id, openchatid: raw.chat_id, openthreadid: raw.thread_id, thread_position: thread })) url.searchParams.set(key, String(value));
        else if (normal !== undefined) { url.searchParams.set('openChatId', String(raw.chat_id)); url.searchParams.set('position', normal); }
        if (url.search) output.message_app_link = url.toString();
    }
    return output;
}

export function resolveSenderNames(messages: JsonObject[], cache: JsonObject = {}): JsonObject[] {
    for (const message of messages) { const sender = object(message.sender); if (sender.id && typeof sender.sender_name === 'string' && sender.sender_name) cache[String(sender.id)] = sender.sender_name; }
    return messages.map((message) => { const sender = object(message.sender); return sender.id && cache[String(sender.id)] ? { ...message, sender: { ...sender, sender_name: sender.sender_name || cache[String(sender.id)] } } : message; });
}

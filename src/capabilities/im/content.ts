import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
export const invalidContent = (message: string): never => { throw new ServiceError('INVALID_ARGUMENTS', message); };
export const remoteImagePattern = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gu;
export function optimizeMarkdown(text: string): string {
    const blocks: string[] = [];
    let output = text.replace(/```[\s\S]*?```/gu, (block) => { blocks.push(block); return `___CB_${blocks.length - 1}___`; });
    if (/^#{1,3} /mu.test(text)) output = output.replace(/^#{2,6} (.+)$/gmu, '##### $1').replace(/^# (.+)$/gmu, '#### $1');
    output = output.replace(/^(#{4,5} .+)\n{1,2}(#{4,5} )/gmu, '$1\n\n$2').replace(/^([^|\n].*)\n(\|.+\|)/gmu, '$1\n\n$2').replace(/((?:^\|.+\|[^\S\n]*\n?)+)/gmu, '$1\n');
    for (const [index, block] of blocks.entries()) output = output.replace(`___CB_${index}___`, block);
    return output.replace(/\n{3,}/gu, '\n\n').replace(/!\[[^\]]*\]\(([^)\s]+)\)/gu, (image, key: string) => key.startsWith('img_') ? image : '');
}
function normalize(value: unknown): unknown {
    if (typeof value === 'string') return value.replace(/<at\s+(?:id|open_id|user_id)="?([^"\s/>]+)"?\s*\/?>/gu, '<at user_id="$1">');
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
    return value;
}
export function mediaSources(args: JsonObject): { flag: string; value: string; image: boolean; markdown?: string }[] {
    const items = ['image', 'file', 'audio', 'video', 'video-cover'].filter((flag) => args[flag] && !/^(img_|file_)/u.test(String(args[flag]))).map((flag) => ({ flag, value: String(args[flag]), image: flag === 'image' || flag === 'video-cover' }));
    for (const match of String(args.markdown ?? '').matchAll(remoteImagePattern)) items.push({ flag: 'markdown', value: match[1]!, image: true, ...{ markdown: match[0] } });
    return items;
}
export function prepareMessage(action: string, args: JsonObject, preview = false): ApiRequest {
    let path = '/open-apis/im/v1/messages';
    const body: JsonObject = {}, query: JsonObject = {};
    if (action === 'send') {
        const recipients = ['chat-id', 'user-id'].filter((flag) => args[flag] !== undefined);
        if (recipients.length !== 1) invalidContent('Provide exactly one chat-id or user-id.');
        const flag = recipients[0]!;
        if (!String(args[flag]).startsWith(flag === 'chat-id' ? 'oc_' : 'ou_')) invalidContent('Invalid recipient ID.');
        body.receive_id = args[flag]; query.receive_id_type = flag === 'chat-id' ? 'chat_id' : 'open_id';
    } else {
        const message = String(args['message-id'] ?? '').trim();
        if (!message.startsWith('om_')) invalidContent('message-id must be an om_ message ID.');
        path += `/${encodeURIComponent(message)}${action === 'reply' ? '/reply' : ''}`;
    }
    if (String(args['idempotency-key'] ?? '').length > 50) invalidContent('idempotency-key exceeds fifty characters.');
    if (args['idempotency-key']) body.uuid = args['idempotency-key'];
    if (action === 'reply' && args['reply-in-thread']) body.reply_in_thread = true;
    const sources = ['text', 'markdown', 'content', 'image', 'file', 'audio', 'video'].filter((flag) => args[flag] !== undefined && args[flag] !== '');
    const attachments = args[action === 'edit' ? 'set-attachments' : 'attachment'] ?? [];
    if (!Array.isArray(attachments) || attachments.some((key) => typeof key !== 'string' || !key.trim().startsWith('file_'))) invalidContent('Attachments must be file_ keys.');
    const clear = Boolean(args['clear-attachments']);
    if (sources.length > 1 || (!sources.length && !(attachments as unknown[]).length && !clear)) invalidContent('Provide one content source or a post attachment operation.');
    if (clear && (attachments as unknown[]).length) invalidContent('Cannot clear and set attachments together.');
    if (Boolean(args.video) !== Boolean(args['video-cover'])) invalidContent('video and video-cover must be supplied together.');
    const source = sources[0];
    let type = source === 'content' ? args['msg-type'] ?? 'text' : source === 'markdown' || !source ? 'post' : source === 'video' ? 'media' : source;
    if (args['msg-type'] !== undefined && source !== 'content' && args['msg-type'] !== type) invalidContent('msg-type conflicts with the content source.');
    if (action === 'edit' && !['text', 'post'].includes(String(type))) invalidContent('Only text and post messages can be edited.');
    if ((clear || (attachments as unknown[]).length) && ((source && !['markdown', 'content'].includes(source)) || (args['msg-type'] !== undefined && args['msg-type'] !== 'post'))) invalidContent('Attachments require post content.');
    if (clear && source !== 'markdown' && args['msg-type'] !== 'post') invalidContent('clear-attachments requires Markdown or msg-type post.');
    let content: JsonObject;
    if (source === 'content') {
        let parsed: unknown;
        try { parsed = JSON.parse(String(args.content)); } catch { invalidContent('content must encode a JSON object.'); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalidContent('content must encode a JSON object.');
        content = parsed as JsonObject;
    } else if (source === 'text') content = { text: args.text };
    else if (source === 'markdown') {
        let markdown = String(args.markdown);
        if (preview) { let index = 0; markdown = markdown.replace(remoteImagePattern, (image) => image.replace(/\(https?:\/\/[^)]+\)/u, `(img_dryrun_${++index})`)); }
        content = { zh_cn: { content: [[{ tag: 'md', text: optimizeMarkdown(markdown) }]] } };
    } else if (source) {
        const key = (flag: string): string => {
            const value = String(args[flag]);
            const image = flag === 'image' || flag === 'video-cover';
            if (value.startsWith(image ? 'img_' : 'file_')) return value;
            if (!/^(artifact:|https?:\/\/)/u.test(value)) invalidContent(`${flag} must be a media key, public URL, or artifact:<id>/<filename>.`);
            if (flag === 'audio') { const path = value.startsWith('http') ? new URL(value).pathname : value; const extension = /\.([^.\/]+)$/u.exec(path)?.[1]?.toLowerCase(); if (extension && !['opus', 'ogg'].includes(extension)) invalidContent('Audio messages require Opus files; send other formats with file.'); }
            if (!preview) invalidContent('Media must be resolved before the message is sent.');
            return image ? 'img_dryrun' : 'file_dryrun';
        };
        content = source === 'image' ? { image_key: key(source) } : { file_key: key(source), ...(source === 'video' ? { image_key: key('video-cover') } : {}) };
    } else content = { zh_cn: { content: [] } };
    if (clear || (attachments as unknown[]).length) {
        if (Array.isArray(content.files) && content.files.length) invalidContent('Content files and attachment flags cannot be combined.');
        type = 'post'; content.files = clear ? [] : [...new Set((attachments as string[]).map((key) => key.trim()))].map((key) => ({ key }));
    }
    body.msg_type = type; body.content = JSON.stringify(['text', 'post'].includes(String(type)) ? normalize(content) : content);
    return { method: action === 'edit' ? 'PUT' : 'POST', path, ...(action === 'send' ? { query } : {}), body };
}
export function projectMessage(data: JsonObject, action: string): JsonObject {
    const key = action === 'edit' ? 'update_time' : 'create_time';
    const raw = data[key], numeric = Number(raw);
    let formatted = raw === undefined || raw === null ? '' : String(raw);
    if (Number.isFinite(numeric) && numeric !== 0) { const date = new Date(numeric > 1e12 ? numeric : numeric * 1000); if (!Number.isNaN(date.valueOf())) formatted = date.toISOString().slice(0, 19).replace('T', ' '); }
    return { message_id: data.message_id ?? null, chat_id: data.chat_id ?? null, [key]: formatted };
}

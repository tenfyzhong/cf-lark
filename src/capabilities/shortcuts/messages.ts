import { messageSendDefinition } from './definitions.ts';
import { ServiceError } from '../../domain/errors.ts';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';

const normalizeMention = (text: string): string => text.replace(/<at\s+(?:id|open_id|user_id)="?([^"\s/>]+)"?\s*\/?>/gu, '<at user_id="$1">');
function normalizeContent(value: unknown): unknown {
    if (typeof value === 'string') return normalizeMention(value);
    if (Array.isArray(value)) return value.map(normalizeContent);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeContent(item)]));
    return value;
}
function prepare(args: JsonObject): ApiRequest {
    const invalid = (message: string): never => { throw new ServiceError('INVALID_ARGUMENTS', message); };
    const recipients = ['chat-id', 'user-id'].filter((key) => args[key] !== undefined);
    if (recipients.length !== 1) invalid('Provide exactly one chat-id or user-id.');
    const recipient = recipients[0]!;
    const sources = ['text', 'markdown', 'content', 'image', 'file', 'audio', 'video'].filter((key) => args[key] !== undefined);
    const attachmentInput = args.attachment ?? [];
    if (!Array.isArray(attachmentInput) || attachmentInput.some((key) => typeof key !== 'string' || !key.trim().startsWith('file_'))) invalid('attachment must contain file keys beginning with file_.');
    const attachments = attachmentInput as string[];
    if (sources.length > 1 || (!sources.length && !attachments.length)) invalid('Provide exactly one content source, or attachments only.');
    if (Boolean(args.video) !== Boolean(args['video-cover'])) invalid('video and video-cover must be supplied together.');
    const source = sources[0];
    let type = source === 'markdown' || !source ? 'post' : source === 'video' ? 'media' : source === 'content' ? args['msg-type'] ?? 'text' : source;
    if (source !== 'content' && args['msg-type'] !== undefined && args['msg-type'] !== type) invalid('msg-type conflicts with the content source.');
    let content: JsonObject;
    if (source === 'text') content = { text: args.text };
    else if (source === 'markdown') content = { zh_cn: { content: [[{ tag: 'md', text: args.markdown }]] } };
    else if (source === 'content') {
        let parsed: unknown;
        try { parsed = JSON.parse(String(args.content)); } catch { invalid('content must encode a JSON object.'); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalid('content must encode a JSON object.');
        content = parsed as JsonObject;
    } else if (source) {
        for (const key of source === 'video' ? ['video', 'video-cover'] : [source]) {
            const prefix = key === 'image' || key === 'video-cover' ? 'img_' : 'file_';
            if (typeof args[key] !== 'string' || !String(args[key]).startsWith(prefix)) invalid(`${key} currently requires an existing ${prefix} key. Artifact and URL resolution are not yet implemented.`);
        }
        content = source === 'image' ? { image_key: args.image } : { file_key: args[source], ...(source === 'video' ? { image_key: args['video-cover'] } : {}) };
    } else content = { zh_cn: { content: [] } };
    if (attachments.length) {
        if (source && !['markdown', 'content'].includes(source)) invalid('Attachments require a post body and cannot accompany text or standalone media.');
        if (args['msg-type'] !== undefined && args['msg-type'] !== 'post') invalid('Attachments imply post and conflict with msg-type.');
        if (Array.isArray(content.files)) invalid('Do not combine attachment with a content files array.');
        type = 'post';
        content.files = [...new Set(attachments.map((key) => String(key).trim()))].map((key) => ({ key }));
    }
    return { method: 'POST', path: '/open-apis/im/v1/messages', query: { receive_id_type: recipient === 'chat-id' ? 'chat_id' : 'open_id' },
        body: { receive_id: args[recipient], msg_type: type, content: JSON.stringify(type === 'text' || type === 'post' ? normalizeContent(content) : content),
            ...(args['idempotency-key'] === undefined ? {} : { uuid: args['idempotency-key'] }) } };
}

export function messageSendCapability(): Capability {
    return {
        definition: messageSendDefinition,
        preview: async (args) => prepare(args),
        execute: async (args, context) => context.lark.request(prepare(args)),
    };
}

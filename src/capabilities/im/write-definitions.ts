import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 };
const attachments = { type: 'array', items: text };
const common = { text, markdown: text, content: text, 'msg-type': { enum: ['text', 'post', 'image', 'file', 'audio', 'media', 'interactive', 'share_chat', 'share_user'] } };
const media = { ...Object.fromEntries(['image', 'file', 'audio', 'video', 'video-cover'].map((key) => [key, text])), attachment: attachments, 'idempotency-key': { type: 'string', maxLength: 50 } };
export const writeDefinitions: CommandDefinition[] = ['send', 'reply', 'edit'].map((action) => {
    const properties: JsonObject = action === 'edit'
        ? { ...common, 'message-id': text, 'set-attachments': attachments, 'clear-attachments': { type: 'boolean' }, 'msg-type': { enum: ['text', 'post'] } }
        : { ...common, ...media, ...(action === 'send' ? { 'chat-id': text, 'user-id': text } : { 'message-id': text, 'reply-in-thread': { type: 'boolean' } }) };
    return {
        id: `im.+messages-${action}`, domain: 'im', source: 'shortcut', risk: 'write',
        identities: action === 'edit' ? ['bot'] : ['user', 'bot'],
        scopes: action === 'edit' ? ['im:message:send_as_bot'] : ['im:message.send_as_user', 'im:message', 'im:message:send_as_bot'],
        description: `${action} messages with text, optimized Markdown, JSON, and post attachment handling. Media accepts keys, public URLs, or artifact:<id>/<filename>. Resume media workflows until completed. Editing requires bot identity.`,
        inputSchema: { type: 'object', additionalProperties: false, properties },
    };
});

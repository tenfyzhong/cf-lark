import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string' }, bool = { type: 'boolean' };
const page = { 'page-size': { type: 'integer', minimum: 1, maximum: 50 }, limit: { type: 'integer', minimum: 1, maximum: 50 }, 'page-token': text, 'page-all': bool, 'page-limit': { type: 'integer', minimum: 0 }, 'page-delay': { type: 'integer', minimum: 0 } };
const enrich = { 'no-reactions': bool, 'download-resources': bool };
const schemas: Record<string, JsonObject> = {
    'messages-mget': { 'message-ids': text, 'message-id': text, ...enrich },
    'chat-messages-list': { ...page, ...enrich, 'chat-id': text, 'user-id': text, start: text, 'start-time': text, end: text, 'end-time': text, order: text, sort: text, 'sort-order': text, concise: bool },
    'threads-messages-list': { ...page, ...enrich, thread: text, 'thread-id': text, order: text, sort: text, concise: bool },
    'messages-search': { ...page, query: text, keyword: text, 'chat-id': text, sender: text, 'include-attachment-type': { enum: ['file', 'image', 'video', 'link'] }, 'chat-type': { enum: ['group', 'p2p'] }, 'sender-type': { enum: ['user', 'bot'] }, 'exclude-sender-type': { enum: ['user', 'bot'] }, 'is-at-me': bool, 'at-chatter-ids': text, start: text, end: text, 'no-reactions': bool },
};
export const readDefinitions: CommandDefinition[] = Object.entries(schemas).map(([name, properties]) => ({ id: `im.+${name}`, domain: 'im', source: 'shortcut', risk: 'read', identities: ['user', 'bot'], scopes: name === 'messages-search' ? ['search:message', 'im:message.reactions:read'] : ['im:message.group_msg', 'im:message.group_msg:get_as_user', 'im:message.p2p_msg:get_as_user', 'im:message.p2p_msg:readonly', 'im:message.reactions:read'], description: `${name.replaceAll('-', ' ')} with target resolution, bounded pagination and reaction enrichment. Resume returned workflows until completed. Includes readable cards, thread replies, merged forwards, folders and optional private resource downloads.`, inputSchema: { type: 'object', additionalProperties: false, properties } }));

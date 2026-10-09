import type { CommandDefinition } from '../../domain/models';

export const documentCreateDefinition: CommandDefinition = { id: 'docs.+create', domain: 'docs', source: 'shortcut', risk: 'write',
    description: 'Create a document from inline XML or Markdown and an optional title. Use user identity to own the document. Supports private artifact resources, reference maps and resumable creation.',
    identities: ['user', 'bot'], scopes: ['docx:document:create'],
    inputSchema: { type: 'object', additionalProperties: false, properties: {
        'api-version':{type:'string'},format:{enum:['json','pretty','table','ndjson','csv']},json:{type:'boolean'},markdown:{type:'string'},'folder-token':{type:'string'},'wiki-node':{type:'string'},'wiki-space':{type:'string'},title: { type: 'string', minLength: 1 }, content: { type: 'string', minLength: 1 }, 'reference-map': { type: 'string' },
        'doc-format': { type: 'string', enum: ['xml', 'markdown'], default: 'xml' },
        'parent-token': { type: 'string', minLength: 1 }, 'parent-position': { type: 'string', minLength: 1 },
    } },
};

export const messageSendDefinition: CommandDefinition = { id: 'im.+messages-send', domain: 'im', source: 'shortcut', risk: 'write',
    description: 'Send text, Markdown, JSON, existing media keys, or post attachments to a user or chat. Requires write consent. Artifact and URL media resolution are not yet supported.',
    identities: ['user', 'bot'], scopes: ['im:message.send_as_user', 'im:message', 'im:message:send_as_bot'],
    inputSchema: { type: 'object', additionalProperties: false, properties: {
        'chat-id': { type: 'string', pattern: '^oc_.+' }, 'user-id': { type: 'string', pattern: '^ou_.+' },
        text: { type: 'string', minLength: 1 }, markdown: { type: 'string', minLength: 1 }, content: { type: 'string', minLength: 1 },
        'msg-type': { type: 'string', enum: ['text', 'post', 'image', 'file', 'audio', 'media', 'interactive', 'share_chat', 'share_user'] },
        'idempotency-key': { type: 'string', maxLength: 50 },
        ...Object.fromEntries(['image', 'file', 'audio', 'video', 'video-cover'].map((key) => [key, { type: 'string', minLength: 1 }])),
        attachment: { type: 'array', items: { type: 'string', minLength: 1 } },
    } },
};

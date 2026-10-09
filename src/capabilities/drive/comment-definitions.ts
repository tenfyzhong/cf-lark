import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 }, flag = { type: 'boolean' }, target = { url: text, token: text, type: text };
const pagination = { 'page-size': { type: 'integer', minimum: 1, maximum: 100, default: 50 }, 'page-token': text, 'need-reaction': flag };
const entries: [string, string[], JsonObject][] = [
    ['add-comment', ['doc', 'content'], { doc: text, type: text, content: { type: ['string', 'array'] }, 'full-comment': flag, 'block-id': text }],
    ['list-comments', [], { ...target, ...pagination, 'solved-status': { type: 'string', enum: ['false', 'true', 'all'], default: 'false' }, 'comment-scope': { type: 'string', enum: ['all', 'whole', 'partial'], default: 'all' }, 'need-relation': flag }],
    ['batch-query-comments', ['comment-ids'], { ...target, 'comment-ids': { type: 'array', minItems: 1, maxItems: 100, items: text }, 'need-reaction': flag, 'need-relation': flag }],
    ['resolve-comment', ['comment-id'], { ...target, 'comment-id': text }],
    ['restore-comment', ['comment-id'], { ...target, 'comment-id': text }],
    ['add-reply', ['comment-id', 'content'], { ...target, 'comment-id': text, content: { type: ['string', 'array'] } }],
    ['list-replies', ['comment-id'], { ...target, 'comment-id': text, ...pagination }],
    ['update-reply', ['comment-id', 'reply-id', 'content'], { ...target, 'comment-id': text, 'reply-id': text, content: { type: ['string', 'array'] } }],
    ['delete-reply', ['comment-id', 'reply-id'], { ...target, 'comment-id': text, 'reply-id': text }],
    ['react-reply', ['reply-id', 'emoji', 'action'], { ...target, 'reply-id': text, emoji: text, action: { type: 'string', enum: ['add', 'delete'] } }],
];
export const driveCommentDefinitions: CommandDefinition[] = entries.map(([action, required, properties]) => ({
    id: `drive.+${action}`, domain: 'drive', source: 'shortcut', risk: action.startsWith('list-') || action.startsWith('batch-query') ? 'read' : 'write', identities: ['user', 'bot'],
    scopes: action === 'add-comment' ? ['drive:drive.metadata:readonly', 'docx:document:readonly', 'docs:document.comment:create', 'docs:document.comment:write_only'] : [`docs:document.comment:${action.startsWith('list-') || action.startsWith('batch-query') ? 'read' : action.startsWith('add-') ? 'create' : 'write_only'}`],
    description: `${action.replaceAll('-', ' ')}. Wiki inputs require Wiki node read permission and resolve to the underlying document.`,
    inputSchema: { type: 'object', required, properties, additionalProperties: false },
}));

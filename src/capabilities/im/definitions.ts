import { readDefinitions } from './read-definitions.ts';
import { resourceDefinition } from './resource-definition.ts';
import { writeDefinitions } from './write-definitions.ts';
import { chatReadDefinitions } from './chat-definitions.ts';
import { flagDefinitions } from './flag-definitions.ts';
import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string' };
const bool = { type: 'boolean' };
const page = { 'page-size': { type: 'integer', minimum: 1, maximum: 50, default: 50 }, 'page-token': text, 'page-all': bool, 'page-limit': { type: 'integer', minimum: 1, maximum: 1000, default: 20 }, 'start-time': text, 'end-time': text };
const membersPage = { 'page-size': { type: 'integer', minimum: 1, maximum: 100 }, limit: { type: 'integer', minimum: 1, maximum: 100 }, 'page-token': text, 'page-all': bool, 'page-limit': { type: 'integer', minimum: 0 }, 'page-delay': { type: 'integer', minimum: 0 } };
const schemas: Record<string, JsonObject> = {
    'messages-read-status': { 'message-ids': text, 'message-id': text },
    'message-read-users': { ...membersPage, 'message-id': text, 'user-id-type': { enum: ['open_id', 'union_id', 'user_id'] } },
    'chat-members-list': { ...membersPage, 'chat-id': text, 'member-id-type': { enum: ['open_id', 'union_id', 'user_id'] }, 'member-types': { type: 'array', items: text } },
    'chat-create': { name: text, description: text, users: text, bots: text, owner: text, type: { enum: ['private', 'public'] }, 'chat-mode': { enum: ['group', 'topic'] }, 'set-bot-manager': bool },
    'chat-update': { 'chat-id': text, name: text, description: text },
    'feed-shortcut-create': { 'chat-id': { type: 'array', items: text }, head: bool, tail: bool },
    'feed-shortcut-remove': { 'chat-id': { type: 'array', items: text } },
    'feed-shortcut-list': { 'page-token': text, 'no-detail': bool },
    'feed-group-list': page,
    'feed-group-list-item': { ...page, 'feed-group-id': text },
    'feed-group-query-item': { 'feed-group-id': text, 'feed-id': text },
};
export const imDefinitions: CommandDefinition[] = [...readDefinitions, resourceDefinition, ...writeDefinitions, ...chatReadDefinitions, ...flagDefinitions, ...Object.entries(schemas).map(([name, properties]): CommandDefinition => ({
    id: `im.+${name}`, domain: 'im', source: 'shortcut', risk: /create|update|remove/u.test(name) ? 'write' : 'read',
    identities: (name.startsWith('feed-') || name === 'messages-read-status') ? ['user'] : ['user', 'bot'],
    scopes: name === 'chat-members-list' ? ['im:chat.members:read'] : name.startsWith('message') ? ['im:message:readonly'] : name.startsWith('feed-shortcut') ? [`im:feed.shortcut:${/create|remove/u.test(name) ? 'write' : 'read'}`] : name.startsWith('feed-group') ? ['im:feed_group_v1:read', ...(name === 'feed-group-list' ? [] : ['im:chat:read'])] : name === 'chat-create' ? ['im:chat:create_by_user', 'im:chat:create'] : ['im:chat:update'],
    description: `${name.replaceAll('-', ' ')} with lark-cli validation and response processing. Paginated or enriched reads may return a durable workflow; call workflow.resume until completed.`,
    inputSchema: { type: 'object', properties, additionalProperties: false },
}))];

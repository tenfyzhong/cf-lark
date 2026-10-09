import type { CommandDefinition } from '../../domain/models';

export const contactDefinitions: CommandDefinition[] = [{
    id: 'contact.+get-user', domain: 'contact', source: 'shortcut', risk: 'read', identities: ['user', 'bot'],
    scopes: ['contact:user.basic_profile:readonly', 'contact:user.base:readonly', 'contact:contact.base:readonly'],
    description: 'Get the current user or a specified user. Bot identity requires user-id and returns a full profile; user identity returns basic information.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
        'user-id': { type: 'string', minLength: 1 },
        'user-id-type': { type: 'string', enum: ['open_id', 'union_id', 'user_id'], default: 'open_id' },
    } },
}];

contactDefinitions.push({
    id: 'contact.+search-user', domain: 'contact', source: 'shortcut', risk: 'read', identities: ['user'], scopes: ['contact:user:search'],
    description: 'Search users by keyword, open IDs, or filters. Up to 20 comma-separated queries; one page per query. Preserve has_more and notices and refine incomplete searches.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
        query: { type: 'string', maxLength: 50 }, queries: { type: 'string' }, 'user-ids': { type: 'string' }, lang: { type: 'string' },
        'page-size': { type: 'integer', minimum: 1, maximum: 30, default: 20 },
        ...Object.fromEntries(['has-chatted', 'has-enterprise-email', 'exclude-external-users', 'left-organization'].map((key) => [key, { const: true }])),
    } },
});

contactDefinitions.push({
    id: 'contact.+search-bot', domain: 'contact', source: 'shortcut', risk: 'read', identities: ['user'], scopes: ['search:bot'],
    description: 'Search bots and agents by keyword, optionally within chats. Filters cannot enumerate bots alone. Up to 20 keywords; preserve has_more and query notices.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
        query: { type: 'string', maxLength: 50 }, queries: { type: 'string' }, 'chat-ids': { type: 'string' },
        'has-chatted': { const: true }, 'page-size': { type: 'integer', minimum: 1, maximum: 30, default: 20 },
    } },
});

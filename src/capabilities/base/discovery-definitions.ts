import type { CommandDefinition } from '../../domain/models';
const text = { type: 'string', minLength: 1 };
export const discoveryDefinitions: CommandDefinition[] = [
    { id: 'base.+title-resolve', domain: 'base', source: 'shortcut', risk: 'read', identities: ['user'], scopes: ['search:docs:read'], description: 'Resolve a Base title or keyword into one resource or explicit candidates. Use at most 30 Unicode characters.', inputSchema: { type: 'object', additionalProperties: false, properties: { title: text, query: text, url: text } } },
    { id: 'base.+data-query', domain: 'base', source: 'shortcut', risk: 'read', identities: ['user', 'bot'], scopes: ['base:table:read'], description: 'Analyze Base data with the upstream JSON DSL. Supply dimensions or measures.', inputSchema: { type: 'object', required: ['base-token', 'dsl'], additionalProperties: false, properties: { 'base-token': text, dsl: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'object' }] } } } },
];

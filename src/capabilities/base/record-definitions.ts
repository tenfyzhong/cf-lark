import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 };
const ids = { type: 'array', items: { type: 'string' } };
const specs: Array<[string, JsonObject, string[], string]> = [
    ['record-upsert', { json: { anyOf: [{ type: 'object' }, { type: 'string' }] }, 'record-id': text }, ['json'], 'base:record:create'],
    ['record-batch-create', { json: { anyOf: [{ type: 'object' }, { type: 'string' }] } }, ['json'], 'base:record:create'],
    ['record-batch-update', { json: { anyOf: [{ type: 'object' }, { type: 'string' }] } }, ['json'], 'base:record:update'],
    ['record-delete', { 'record-id': ids, json: { anyOf: [{ type: 'object' }, { type: 'string' }] } }, [], 'base:record:delete'],
    ['record-share-link-create', { 'record-id': ids, 'record-ids': ids }, [], 'base:record:read'],
    ['record-history-list', { 'record-id': text, 'max-version': { type: 'integer', minimum: 1 }, 'page-size': { type: 'integer', minimum: 1, maximum: 50 } }, ['record-id'], 'base:history:read'],
];
export const recordDefinitions: CommandDefinition[] = specs.map(([name, properties, required, scope]) => ({ id: `base.+${name}`, domain: 'base', source: 'shortcut', risk: ['record-history-list', 'record-share-link-create'].includes(name) ? 'read' : 'write', identities: ['user', 'bot'], scopes: name === 'record-upsert' ? [scope, 'base:record:update'] : [scope], description: `${name.replaceAll('-', ' ')} with explicit record coordinates. Deletion is permanent.`, inputSchema: { type: 'object', required: ['base-token', 'table-id', ...required], additionalProperties: false, properties: { 'base-token': text, 'table-id': text, ...properties } } }));

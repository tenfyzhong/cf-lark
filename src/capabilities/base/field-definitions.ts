import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 };
const json = { anyOf: [{ type: 'object' }, { type: 'string', minLength: 1 }] };
const specs: Array<[string, JsonObject, string[], string]> = [
    ['field-extension-get', {}, [], 'base:field:read'],
    ['field-extension-update', { json }, ['json'], 'base:field:update'],
    ['field-extension-update-cells', { type: { type: 'string', enum: ['column', 'row'] }, 'view-id': text, 'record-id': { type: 'array', items: text } }, ['type'], 'base:record:update'],
    ['field-update', { json, 'i-have-read-guide': { type: 'boolean' } }, ['json'], 'base:field:update'],
];
export const fieldDefinitions: CommandDefinition[] = specs.map(([name, properties, extra, scope]) => ({ id: `base.+${name}`, domain: 'base', source: 'shortcut', identities: ['user', 'bot'], risk: name.endsWith('get') ? 'read' : 'write', scopes: [scope], description: `${name.replaceAll('-', ' ')}. Extension updates may replace generated content; row updates require explicit IDs.`, inputSchema: { type: 'object', required: ['base-token', 'table-id', 'field-id', ...extra], additionalProperties: false, properties: { 'base-token': text, 'table-id': text, 'field-id': text, ...properties } } }));

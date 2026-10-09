import type { CommandDefinition } from '../../domain/models';
const text = { type: 'string', minLength: 1 };
export const copyDefinitions: CommandDefinition[] = [{ id: 'base.+table-copy-status', domain: 'base', source: 'shortcut', risk: 'read', identities: ['user', 'bot'], scopes: ['base:table:create'], description: 'Query one table copy task. Continue the existing task rather than resubmitting a copy.', inputSchema: { type: 'object', required: ['base-token', 'task-id'], additionalProperties: false, properties: { 'base-token': text, 'task-id': text } } }];

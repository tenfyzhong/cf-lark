import type { CommandDefinition, JsonObject } from '../../domain/models';

const name = { type: 'string', minLength: 1 };
const editable = { description: name, 'description-i18n': { type: 'array', items: { type: 'string' } }, 'icon-key': name };
const targets = { command: name, 'command-id': name };
const schemas: Record<string, JsonObject> = {
    list: { type: 'object', properties: {}, additionalProperties: false },
    create: { type: 'object', required: ['command', 'description'], additionalProperties: false, properties: { command: name, ...editable, force: { type: 'boolean', description: 'Explicit idempotent upsert only. Never infer force from an already-exists error.' } } },
    update: { type: 'object', additionalProperties: false, properties: { ...targets, ...editable } },
    delete: { type: 'object', additionalProperties: false, properties: targets },
};
export const applicationDefinitions: CommandDefinition[] = ['list', 'create', 'update', 'delete'].map((action) => ({
    id: `application.+slash-command-${action}`, domain: 'application', source: 'shortcut', risk: action === 'list' ? 'read' : 'write',
    identities: ['user', 'bot'], scopes: [`application:app_slash_command:${action === 'list' ? 'read' : 'write'}`],
    description: `${action === 'delete' ? 'Permanently delete' : action[0]!.toUpperCase() + action.slice(1)} slash commands on the selected app. Name resolution requires application:app_slash_command:read. Client changes may take five minutes to appear.`,
    inputSchema: schemas[action]!,
}));

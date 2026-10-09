import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 };
const json = { anyOf: [{ type: 'string' }, { type: 'object' }] };
export const blockDefinitions: CommandDefinition[] = ['dashboard', 'app'].flatMap(family => ['create', 'update'].map(action => {
    const required = family === 'app' ? ['app-token', 'page-id'] : ['base-token', 'dashboard-id'];
    required.push(...(action === 'create' ? ['name', 'type'] : ['block-id']));
    const properties: JsonObject = { ...Object.fromEntries(required.map(key => [key, text])), name: { type: 'string' }, 'data-config': json, 'no-validate': { type: 'boolean' } };
    if (family === 'app' && action === 'create') properties['sub-type'] = { type: 'string' };
    if (family === 'dashboard') Object.assign(properties, { position: json, 'user-id-type': { type: 'string' } });
    return { id: `base.+${family}-block-${action}`, domain: 'base', source: 'shortcut', identities: ['user', 'bot'], risk: 'write', scopes: family === 'app' ? [`base:appmode_block:${action}`, 'base:appmode_block:read'] : [`base:dashboard:${action === 'create' ? 'create' : 'update'}`], description: `${action} ${family} block with pinned configuration validation, name uniqueness and workspace checks where applicable.`, inputSchema: { type: 'object', required, properties, additionalProperties: false } } as CommandDefinition;
}));

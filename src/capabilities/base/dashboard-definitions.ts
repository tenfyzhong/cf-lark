import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string' };
const specs: Array<[string, string[], JsonObject, string]> = [];
for (const action of ['list', 'get', 'create', 'update', 'delete', 'arrange', 'block-list', 'block-get', 'block-delete', 'block-get-data']) {
    const required = ['base-token', ...(['list', 'create', 'block-get-data'].includes(action) ? [] : ['dashboard-id']), ...(action.startsWith('block-') && action !== 'block-list' ? ['block-id'] : []), ...(action === 'create' ? ['name'] : [])];
    const properties: JsonObject = {};
    if (action.endsWith('list')) Object.assign(properties, { 'page-size': { type: 'integer', minimum: 1, maximum: 100 }, 'page-token': text });
    if (action === 'create' || action === 'update') Object.assign(properties, { name: text, 'theme-style': text });
    if (action === 'block-get' || action === 'arrange') properties['user-id-type'] = text;
    if (action === 'block-get-data') properties['dashboard-id'] = text;
    const permission = action.includes('get') || action.endsWith('list') ? 'read' : action.endsWith('delete') ? 'delete' : action === 'create' ? 'create' : 'update';
    specs.push([`dashboard-${action}`, required, properties, `base:dashboard:${permission}`]);
}
specs.push(['app-block-get-data', ['app-token', 'base-token', 'block-id'], {}, 'base:appmode_block:read']);
export const dashboardDefinitions: CommandDefinition[] = specs.map(([name, required, properties, scope]) => ({ id: `base.+${name}`, domain: 'base', source: 'shortcut', identities: ['user', 'bot'], risk: name.includes('-get') || name.endsWith('-list') ? 'read' : 'write', scopes: [scope], description: `${name.replaceAll('-', ' ')}. Computed data uses chart block coordinates; arrange changes the layout.`, inputSchema: { type: 'object', required, additionalProperties: false, properties: { ...Object.fromEntries(required.map(key => [key, { type: 'string', minLength: 1 }])), ...properties } } }));

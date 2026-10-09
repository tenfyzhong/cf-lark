import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 };
const paging = { 'page-size': { type: 'integer', minimum: 1 }, 'page-token': { type: 'string' } };
export const appThemes = ['default', 'cloudBlue', 'fresh', 'softLight', 'future', 'technology'];
const specs: Array<[string, string[], JsonObject, string[]]> = [
    ['workspace-create', ['name'], {}, ['base:workspace:create']],
    ['workspace-entity-list', ['workspace-token'], { ...paging, type: { type: 'string' } }, ['base:workspace:read']],
    ['workspace-move-in', ['workspace-token', 'entity-token'], {}, ['base:workspace:update']],
    ['app-create', ['name', 'workspace-token'], { 'theme-style': { type: 'string', enum: appThemes } }, ['base:appmode:create', 'base:workspace:update']],
    ['app-get', ['app-token'], {}, ['base:appmode:read']],
];
for (const family of ['page', 'block']) for (const action of ['get', 'list', ...(family === 'page' ? ['delete'] : [])]) specs.push([`app-${family}-${action}`, ['app-token', ...(family === 'block' || action !== 'list' ? ['page-id'] : []), ...(family === 'block' && action === 'get' ? ['block-id'] : [])], action === 'list' ? paging : {}, [`base:appmode_${family}:${action === 'delete' ? 'delete' : 'read'}`]]);
export const appDefinitions: CommandDefinition[] = specs.map(([name, required, properties, scopes]) => ({ id: `base.+${name}`, domain: 'base', source: 'shortcut', identities: ['user', 'bot'], risk: /-(get|list)$/.test(name) ? 'read' : 'write', scopes, description: `${name.replaceAll('-', ' ')}. Workspace, app, page and block coordinates are distinct.`, inputSchema: { type: 'object', required, additionalProperties: false, properties: { ...Object.fromEntries(required.map(key => [key, text])), ...properties } } }));

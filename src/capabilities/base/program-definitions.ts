import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 };
const json = { anyOf: [{ type: 'string', minLength: 1 }, { type: 'object' }, { type: 'array' }] };
const specs: Array<[string, string[], JsonObject, string[]]> = [
    ['url-resolve', [], { url: text, query: text }, []],
    ['base-copy', ['base-token'], { name: text, 'folder-token': text, 'time-zone': text, 'without-content': { type: 'boolean' } }, ['base:app:copy', 'docs:permission.member:create']],
    ['base-create', ['name'], { 'folder-token': text, 'time-zone': text, 'table-name': text, fields: json }, ['base:app:create', 'base:table:read', 'base:table:create', 'base:table:update', 'base:table:delete', 'docs:permission.member:create']],
    ['table-copy', ['base-token', 'table-id', 'name'], { range: { type: 'string', enum: ['schema', 'all'] }, wait: { type: 'boolean' }, timeout: { type: 'string' } }, ['base:table:create']],
    ['field-create', ['base-token', 'table-id', 'json'], { json, 'i-have-read-guide': { type: 'boolean' } }, ['base:field:create']],
    ['table-get', ['base-token', 'table-id'], {}, ['base:table:read', 'base:field:read', 'base:view:read']],
    ['table-create', ['base-token', 'name', 'fields'], { fields: json, view: json }, ['base:table:create', 'base:field:read', 'base:field:create', 'base:field:update', 'base:view:write_only']],
    ['view-create', ['base-token', 'table-id', 'json'], { json }, ['base:view:write_only']],
    ['form-list', ['base-token', 'table-id'], { 'page-size': { type: 'integer', minimum: 1, maximum: 100 } }, ['base:form:read']],
    ['workflow-list', ['base-token'], { status: { type: 'string', enum: ['enabled', 'disabled'] }, 'page-size': { type: 'integer', minimum: 1, maximum: 100 } }, ['base:workflow:read']],
    ['app-page-create', ['app-token', 'name'], {}, ['base:appmode_page:create', 'base:appmode_page:read']],
    ['app-page-update', ['app-token', 'page-id', 'name'], {}, ['base:appmode_page:update', 'base:appmode_page:read']],
];
for (const action of ['bind', 'get', 'unbind']) specs.push([`button-rule-${action}`, ['base-token', 'table-id', 'field-id', ...(action === 'bind' ? ['workflow-id'] : [])], {}, ['base:field:read', ...(action === 'get' ? [] : ['base:field:update'])]]);
export const programDefinitions: CommandDefinition[] = specs.map(([name, required, properties, scopes]) => ({ id: `base.+${name}`, domain: 'base', source: 'shortcut', identities: ['user', 'bot'], risk: /-(get|list|resolve)$/.test(name) ? 'read' : 'write', scopes, description: `${name.replaceAll('-', ' ')}. Returns a durable workflow; call workflow.resume until completed. JSON files use @artifact-id.`, inputSchema: { type: 'object', required, additionalProperties: false, properties: { ...Object.fromEntries(required.map(key => [key, text])), ...properties } } }));

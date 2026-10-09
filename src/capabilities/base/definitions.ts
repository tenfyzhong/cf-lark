import { recordReadDefinitions } from './record-read-definitions.ts';
import { attachmentDefinitions } from './attachment-definitions.ts';
import { blockDefinitions } from './block-definitions.ts';
import { workflowWriteDefinitions } from './workflow-definitions.ts';
import { recordDefinitions } from './record-definitions.ts';
import { copyDefinitions } from './copy-definitions.ts';
import { discoveryDefinitions } from './discovery-definitions.ts';
import { questionDefinitions } from './question-definitions.ts';
import { fieldDefinitions } from './field-definitions.ts';
import { dashboardDefinitions } from './dashboard-definitions.ts';
import { formDefinitions } from './form-definitions.ts';
import { programDefinitions } from './program-definitions.ts';
import { appDefinitions } from './app-definitions.ts';
import { directoryDefinitions } from './directory-definitions.ts';
import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 };
const json = { anyOf: [{ type: 'string', minLength: 1 }, { type: 'object' }, { type: 'array' }] };
const specs: Array<{ name: string; required: string[]; properties?: JsonObject; scope: string }> = [];
for (const family of ['table', 'field', 'view']) {
    const required = ['base-token', ...(family === 'table' ? [] : ['table-id'])];
    specs.push({ name: `${family}-list`, required, properties: { offset: { type: 'integer' }, limit: { type: 'integer' }, 'page-size': { type: 'integer' } }, scope: `base:${family}:read` });
    for (const action of ['get', 'delete']) if (!(family === 'table' && action === 'get')) specs.push({ name: `${family}-${action}`, required: [...required, `${family}-id`], scope: `base:${family}:${action === 'get' ? 'read' : family === 'view' ? 'write_only' : 'delete'}` });
}
specs.push({ name: 'table-update', required: ['base-token', 'table-id', 'name'], scope: 'base:table:update' });
specs.push({ name: 'view-rename', required: ['base-token', 'table-id', 'view-id', 'name'], scope: 'base:view:write_only' });
for (const property of ['filter', 'visible-fields', 'group', 'sort', 'timebar', 'card']) {
    for (const action of ['get', 'set']) specs.push({ name: `view-${action}-${property}`, required: ['base-token', 'table-id', 'view-id', ...(action === 'set' ? ['json'] : [])], properties: action === 'set' ? { json } : {}, scope: `base:view:${action === 'get' ? 'read' : 'write_only'}` });
}
specs.push({ name: 'field-search-options', required: ['base-token', 'table-id', 'field-id'], properties: { keyword: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' }, 'page-size': { type: 'integer' } }, scope: 'base:field:read' });
for (const action of ['create', 'update', 'get', 'list', 'delete']) specs.push({ name: `role-${action}`, required: ['base-token', ...(['create', 'list'].includes(action) ? [] : ['role-id']), ...(['create', 'update'].includes(action) ? ['json'] : [])], scope: `base:role:${['get', 'list'].includes(action) ? 'read' : action}` });
for (const action of ['enable', 'disable']) specs.push({ name: `advperm-${action}`, required: ['base-token'], scope: 'base:app:update' });
for (const action of ['get', 'enable', 'disable']) specs.push({ name: `workflow-${action}`, required: ['base-token', 'workflow-id'], properties: action === 'get' ? { 'user-id-type': { type: 'string', enum: ['open_id', 'union_id', 'user_id'] } } : {}, scope: `base:workflow:${action === 'get' ? 'read' : 'update'}` });
export const coreDefinitions: CommandDefinition[] = specs.map(spec => ({
    id: `base.+${spec.name}`, domain: 'base', source: 'shortcut', identities: ['user', 'bot'],
    risk: /-(get|list|search)(-|$)/.test(spec.name) ? 'read' : 'write', scopes: [spec.scope],
    description: `${spec.name.replaceAll('-', ' ')} in Lark Base. IDs or names are accepted where supported upstream. JSON accepts inline JSON or native objects.`,
    inputSchema: { type: 'object', required: spec.required, additionalProperties: false, properties: { ...Object.fromEntries(spec.required.map(key => [key, key === 'json' ? json : text])), ...spec.properties } },
}));

export const baseDefinitions = [...coreDefinitions, ...directoryDefinitions, ...appDefinitions, ...programDefinitions, ...formDefinitions, ...dashboardDefinitions, ...fieldDefinitions, ...questionDefinitions, ...discoveryDefinitions, ...copyDefinitions, ...recordDefinitions, ...workflowWriteDefinitions, ...blockDefinitions, ...attachmentDefinitions, ...recordReadDefinitions];

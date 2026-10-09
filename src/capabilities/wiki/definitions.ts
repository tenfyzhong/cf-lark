import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 };
const pagination = { 'page-size': { type: 'integer', minimum: 1, maximum: 50, default: 50 }, 'page-token': text, 'page-all': { type: 'boolean' }, 'page-limit': { type: 'integer', minimum: 0, default: 10 } };
const member = { 'space-id': text, 'member-id': text, 'member-type': { type: 'string', enum: ['openid', 'userid', 'email', 'unionid', 'openchat', 'opendepartmentid', 'appid'] }, 'member-role': { type: 'string', enum: ['admin', 'member'] } };
const entries: [string, string, string[], JsonObject, string[]][] = [
    ['node-get', 'wiki:node:retrieve', [], { 'node-token': text, token: text, 'obj-type': text, 'space-id': text }, ['user', 'bot']],
    ['node-create', 'wiki:node:create', [], { 'space-id': text, 'parent-node-token': text, title: text, 'node-type': { type: 'string', enum: ['origin', 'shortcut'], default: 'origin' }, 'obj-type': { type: 'string', enum: ['doc', 'docx', 'sheet', 'bitable', 'mindnote', 'slides', 'file'], default: 'docx' }, 'origin-node-token': text }, ['user', 'bot']],
    ['node-copy', 'wiki:node:copy', ['space-id', 'node-token'], { 'space-id': text, 'node-token': text, 'target-space-id': text, 'target-parent-node-token': text, title: text }, ['user', 'bot']],
    ['node-delete', 'wiki:node:create', ['node-token'], { 'space-id': text, 'node-token': text, 'obj-type': text, 'include-children': { type: 'boolean', default: true } }, ['user', 'bot']],
    ['delete-space', 'wiki:space:write_only', ['space-id'], { 'space-id': text }, ['user', 'bot']],
    ['move', 'wiki:node:move', [], { 'node-token': text, 'source-space-id': text, 'target-space-id': text, 'target-parent-token': text, 'obj-type': text, 'obj-token': text, apply: { type: 'boolean' } }, ['user', 'bot']],
    ['move-to-drive', 'space:document:move', ['node-token'], { 'node-token': text, 'folder-token': text }, ['user', 'bot']],
    ['space-list', 'wiki:space:retrieve', [], pagination, ['user', 'bot']],
    ['space-create', 'wiki:space:write_only', ['name'], { name: text, description: text }, ['user']],
    ['node-list', 'wiki:node:retrieve', ['space-id'], { 'space-id': text, 'parent-node-token': text, ...pagination }, ['user', 'bot']],
    ['member-list', 'wiki:member:retrieve', ['space-id'], { 'space-id': text, ...pagination }, ['user', 'bot']],
    ['member-add', 'wiki:member:create', Object.keys(member), { ...member, 'need-notification': { type: 'boolean' } }, ['user', 'bot']],
    ['member-remove', 'wiki:member:update', Object.keys(member), member, ['user', 'bot']],
];
export const wikiDefinitions: CommandDefinition[] = entries.map(([action, scope, required, properties, identities]) => ({
    id: `wiki.+${action}`, domain: 'wiki', source: 'shortcut', risk: (action.endsWith('list') || action === 'node-get') ? 'read' : 'write',
    identities: identities as ('user' | 'bot')[], scopes: [scope, ...(action === 'node-delete' ? ['wiki:node:retrieve'] : action === 'delete-space' ? ['wiki:space:read'] : ['move', 'node-create'].includes(action) ? ['wiki:node:read', 'wiki:space:read'] : action === 'move-to-drive' ? ['wiki:space:read'] : [])],
    description: `${action.replaceAll('-', ' ')} with personal-library resolution and durable pagination. Resume workflow.resume until completed.`,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
}));

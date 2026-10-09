import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 }, flag = { type: 'boolean' };
const target = { token: text, type: text };
const member = { ...target, 'member-id': text, 'member-type': text, 'member-kind': text, 'perm-type': text };
const entries: [string, string, string[], JsonObject][] = [
    ['create-folder', 'space:folder:create', ['name'], { name: text, 'folder-token': text }],
    ['create-shortcut', 'space:document:shortcut', ['file-token', 'type', 'folder-token'], { 'file-token': text, type: text, 'folder-token': text }],
    ['member-add', 'docs:permission.member:create', ['token', 'member-id', 'member-type'], { ...member, perm: text, 'need-notification': flag }],
    ['member-remove', 'docs:permission.member:delete', ['token', 'member-id', 'member-type'], member],
    ['member-list', 'docs:permission.member:retrieve', ['token'], { ...target, fields: text, 'perm-type': text }],
    ['permission-get-setting', 'docs:permission.setting:read', ['token'], target],
    ['apply-permission', 'docs:permission.member:apply', ['token', 'perm'], { ...target, perm: { type: 'string', enum: ['view', 'edit'] }, remark: text }],
    ['secure-label-list', 'docs:secure_label:readonly', [], { 'page-size': { type: 'integer', minimum: 1, maximum: 10, default: 10 }, 'page-token': text, lang: { type: 'string', enum: ['zh', 'en', 'ja'] } }],
    ['secure-label-update', 'docs:secure_label:write_only', ['token', 'label-id'], { ...target, 'label-id': { type: 'string', pattern: '^[0-9]+$' } }],
];
export const driveDefinitions: CommandDefinition[] = entries.map(([action, scope, required, properties]) => ({
    id: `drive.+${action}`, domain: 'drive', source: 'shortcut', risk: action.endsWith('list') || action === 'permission-get-setting' ? 'read' : 'write',
    identities: action.startsWith('secure-label') || action === 'apply-permission' ? ['user'] : ['user', 'bot'], scopes: [scope],
    description: `${action.replaceAll('-', ' ')} with Lark CLI validation and resource URL handling.`, inputSchema: { type: 'object', properties, required, additionalProperties: false },
}));

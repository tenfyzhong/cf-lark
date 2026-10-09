import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 }, target = { url: text, token: text, type: text };
const entries: [string, string[], JsonObject, string][] = [
    ['copy', ['name', 'folder-token'], { ...target, name: text, 'folder-token': text, extra: { type: 'array', items: text } }, 'docs:document:copy'],
    ['update-title', ['title'], { ...target, title: text, 'on-extension-mismatch': { type: 'string', enum: ['keep', 'allow'], default: 'keep' } }, ''],
    ['inspect', ['url'], { url: text, type: text }, 'drive:drive.metadata:readonly'],
    ['version-history', ['file-token'], { 'file-token': text, limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 }, cursor: text }, 'drive:file:download'],
    ['version-revert', ['file-token', 'version'], { 'file-token': text, version: text }, 'drive:file:upload'],
    ['version-delete', ['file-token', 'version'], { 'file-token': text, version: text }, 'drive:file:upload'],
];
export const driveMetadataDefinitions: CommandDefinition[] = entries.map(([action, required, properties, scope]) => ({ id: `drive.+${action}`, domain: 'drive', source: 'shortcut', risk: ['inspect', 'version-history'].includes(action) ? 'read' : 'write', identities: ['user', 'bot'], scopes: scope ? [scope] : [], description: `${action.replaceAll('-', ' ')} with resource resolution and Lark CLI output semantics.`, inputSchema: { type: 'object', required, properties, additionalProperties: false } }));

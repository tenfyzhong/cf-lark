import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 }, bool = { type: 'boolean' }, source = { 'file-token': text, url: text, 'wiki-token': text };
const preview = { version: text, 'list-only': bool, output: text, 'if-exists': { type: 'string', enum: ['error', 'overwrite', 'rename'], default: 'error' } };
const entries: [string, string[], JsonObject][] = [
    ['download', [], { ...source, output: text, overwrite: bool }],
    ['preview', [], { ...source, ...preview, type: text }],
    ['cover', ['file-token'], { 'file-token': text, ...preview, spec: text }],
    ['version-get', ['file-token', 'version'], { 'file-token': text, version: text, output: text, overwrite: bool }],
    ['export-download', ['file-token'], { 'file-token': text, 'file-name': text, 'output-dir': { type: 'string', default: '.' }, overwrite: bool }],
];
export const driveDownloadDefinitions: CommandDefinition[] = entries.map(([action, required, properties]) => ({ id: `drive.+${action}`, domain: 'drive', source: 'shortcut', risk: 'read', identities: ['user', 'bot'], scopes: [action === 'export-download' ? 'docs:document:export' : 'drive:file:download'], description: `${action} to a private artifact. Requires artifact write permission for downloads; local output paths become filename hints and each download gets a new immutable artifact.`, inputSchema: { type: 'object', required, properties, additionalProperties: false } }));

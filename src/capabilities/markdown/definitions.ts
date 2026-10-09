import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 }, flag = { type: 'boolean' }, content = { type: 'string', maxLength: 262144, description: 'Inline content; larger inputs use a private artifact ID in file.' };
const entries: [string, string[], JsonObject][] = [
    ['create', [], { 'folder-token': text, 'wiki-token': text, name: text, content, file: text }],
    ['overwrite', ['file-token'], { 'file-token': text, name: text, content, file: text }],
    ['patch', ['file-token', 'pattern', 'content'], { 'file-token': text, pattern: text, content, regex: flag }],
    ['fetch', ['file-token'], { 'file-token': text, output: text, overwrite: flag }],
    ['diff', ['file-token'], { 'file-token': text, 'from-version': text, 'to-version': text, file: text, 'context-lines': { type: 'integer', minimum: 0, default: 3 } }],
];
export const markdownDefinitions: CommandDefinition[] = entries.map(([action, required, properties]) => ({
    id: `markdown.+${action}`, domain: 'markdown', source: 'shortcut', risk: ['fetch', 'diff'].includes(action) ? 'read' : 'write', identities: ['user', 'bot'],
    scopes: action === 'patch' ? ['drive:file:download', 'drive:file:upload', 'drive:drive.metadata:readonly'] : ['fetch', 'diff'].includes(action) ? ['drive:file:download'] : ['drive:file:upload', 'drive:drive.metadata:readonly'],
    description: `${action} native Markdown files. File inputs and outputs use private artifacts; artifact read/write permission is needed for staging. Resume workflow.resume until completed.`,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
}));

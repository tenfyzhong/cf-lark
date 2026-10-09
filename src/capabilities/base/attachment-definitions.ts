import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 }, strings = { type: 'array', items: text, maxItems: 50 };
export const attachmentDefinitions: CommandDefinition[] = ['record-upload-attachment', 'record-download-attachment', 'record-remove-attachment', 'form-submit'].map(name => {
    const form = name === 'form-submit', download = name.includes('download'), upload = name.includes('upload');
    const required = form ? ['share-token', 'json'] : ['base-token', 'table-id', 'record-id', ...(download ? ['output'] : ['field-id', upload ? 'file' : 'file-token'])];
    const properties: JsonObject = { ...Object.fromEntries(required.map(key => [key, text])) };
    if (form) Object.assign(properties, { json: { anyOf: [{ type: 'string' }, { type: 'object' }] }, 'base-token': text });
    else if (download) Object.assign(properties, { 'file-token': strings, overwrite: { type: 'boolean' } });
    else properties[upload ? 'file' : 'file-token'] = { ...strings, minItems: 1 };
    if (upload || form) properties.artifactNames = { type: 'object', additionalProperties: { type: 'string' } };
    if (upload) properties.name = { type: 'string', description: 'Deprecated and rejected, matching upstream. Use artifactNames to preserve source filenames.' };
    return { id: `base.+${name}`, domain: 'base', source: 'shortcut', identities: ['user', 'bot'], risk: download ? 'read' : 'write', scopes: form ? ['base:form:update', 'docs:document.media:upload'] : download ? ['base:record:read', 'docs:document.media:download'] : ['base:record:update', 'base:field:read', ...(upload ? ['docs:document.media:upload'] : [])], description: `${name.replaceAll('-', ' ')}. Local files use private artifact IDs; downloads return private artifacts. artifactNames preserves source filenames.`, inputSchema: { type: 'object', required, properties, additionalProperties: false } };
});

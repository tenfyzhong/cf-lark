import type { CommandDefinition } from '../../domain/models';

const file = { type: 'string', minLength: 1, description: 'Private artifact ID owned by this MCP connection.' };
const name = { type: 'string', minLength: 1, description: 'Remote filename; defaults to the artifact ID.' };
const token = { type: 'string', minLength: 1, pattern: '^[A-Za-z0-9_-]+$' };
export const uploadDefinitions: CommandDefinition[] = [
    { id: 'drive.+upload', domain: 'drive', source: 'shortcut', risk: 'write', identities: ['user', 'bot'], scopes: ['drive:file:upload', 'drive:drive.metadata:readonly'],
        description: 'Upload a private artifact to Drive root, folder, or wiki, optionally overwriting a file. Requires artifact read access. Returns a workflow ID: call workflow.resume with the returned selection until completed, without restarting upload.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['file'], properties: { file, name, 'file-token': token, 'folder-token': token, 'wiki-token': token } } },
    { id: 'docs.+media-upload', domain: 'docs', source: 'shortcut', risk: 'write', identities: ['user', 'bot'], scopes: ['docs:document.media:upload'],
        description: 'Upload a private artifact as document media, using bounded parts for large files. Requires artifact read access. Resume the returned workflow ID using workflow.resume and the returned selection until completed.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['file', 'parent-type', 'parent-node'], properties: {
            file, name, 'parent-type': { type: 'string', minLength: 1 }, 'parent-node': token, 'doc-id': token,
        } } },
];

import type { CommandDefinition } from '../../domain/models';

export const noteDefinitions: CommandDefinition[] = [{
    id: 'note.+detail', domain: 'note', source: 'shortcut', risk: 'read', identities: ['user', 'bot'], scopes: ['vc:note:read'],
    description: 'Get note metadata, display type, main document, verbatim transcript and shared document tokens. Creation time uses UTC in this cloud service.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['note-id'], properties: { 'note-id': { type: 'string', minLength: 1 } } },
}];

noteDefinitions.push({
    id: 'note.+transcript', domain: 'note', source: 'shortcut', risk: 'read', identities: ['user'], scopes: ['vc:note:read'],
    description: 'Fetch every page of a unified note transcript into one private artifact. Requires artifact read/write and workflow consent; call workflow.resume until completed.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['note-id'], properties: {
        'note-id': { type: 'string', minLength: 1 }, 'transcript-format': { type: 'string', enum: ['markdown', 'plain_text'], default: 'markdown' },
        locale: { type: 'string' }, output: { type: 'string', description: 'Relative output filename; the stored result uses a new private artifact ID.' }, overwrite: { type: 'boolean' },
    } },
});

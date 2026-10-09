import type { CommandDefinition } from '../../domain/models';
const text = { type: 'string', minLength: 1 };
export const docsAuthoringDefinitions: CommandDefinition[] = [
    'media-insert',
    'resource-update',
].map((name) => ({
    id: `docs.+${name}`,
    domain: 'docs',
    source: 'shortcut',
    risk: 'write',
    identities: ['user', 'bot'],
    scopes: [
        'docs:document.media:upload',
        'docx:document:write_only',
        'docx:document:readonly',
    ],
    description: `${name} with durable upload checkpoints. Continue workflow.resume until completed. File and clipboard inputs are grant-owned artifact IDs.`,
    inputSchema: {
        type: 'object',
        required: ['doc'],
        additionalProperties: false,
        properties: {
            doc: text,
            file: text,
            'from-clipboard': { type: 'boolean' },
            'clipboard-artifact': text,
            ...(name === 'resource-update'
                ? {
                      url: text,
                      type: { enum: ['cover'] },
                      'offset-ratio-x': { type: 'number' },
                      'offset-ratio-y': { type: 'number' },
                  }
                : {
                      type: { enum: ['image', 'file'] },
                      align: { enum: ['left', 'center', 'right'] },
                      caption: { type: 'string' },
                      'file-view': { enum: ['card', 'preview', 'inline'] },
                      width: { type: 'integer', minimum: 1, maximum: 10000 },
                      height: { type: 'integer', minimum: 1, maximum: 10000 },
                  }),
        },
    },
}));

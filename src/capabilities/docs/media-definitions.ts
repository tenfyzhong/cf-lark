import type { CommandDefinition } from '../../domain/models';
const text = { type: 'string', minLength: 1 };
export const docsMediaDefinitions: CommandDefinition[] = [
    'media-download',
    'media-preview',
    'resource-download',
    'resource-delete',
].map((name) => ({
    id: `docs.+${name}`,
    domain: 'docs',
    source: 'shortcut',
    risk: name === 'resource-delete' ? 'write' : 'read',
    identities: ['user', 'bot'],
    scopes: name.startsWith('resource-')
        ? [
              'docx:document:readonly',
              ...(name === 'resource-delete'
                  ? ['docx:document:write_only']
                  : ['docs:document.media:download']),
          ]
        : ['docs:document.media:download'],
    description: `${name} with permission checks and private artifact output. Downloads require artifact write permission.`,
    inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: [
            name.startsWith('resource-') ? 'doc' : 'token',
            ...(name === 'resource-delete' ? [] : ['output']),
        ],
        properties: {
            ...(name.startsWith('resource-')
                ? { doc: text, type: { enum: ['cover'] } }
                : {
                      token: text,
                      ...(name === 'media-download'
                          ? { type: { enum: ['media', 'whiteboard'] } }
                          : {}),
                  }),
            ...(name === 'resource-delete'
                ? {}
                : { output: text, overwrite: { type: 'boolean' } }),
        },
    },
}));

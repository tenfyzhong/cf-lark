import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 };
const update: JsonObject = {
    type: 'object',
    required: ['whiteboard-token', 'source'],
    additionalProperties: false,
    properties: {
        'whiteboard-token': text,
        source: text,
        'idempotent-token': { type: 'string', minLength: 10 },
        overwrite: { type: 'boolean' },
        input_format: { enum: ['raw', 'plantuml', 'mermaid', 'svg'] },
    },
};
export const whiteboardDefinitions: CommandDefinition[] = [
    'whiteboard.+update',
    'docs.+whiteboard-update',
    'whiteboard.+export',
    'whiteboard.+query',
].map((id) => {
    const write = id.endsWith('update');
    const legacy = id.endsWith('query');
    return {
        id,
        domain: id.split('.')[0]!,
        source: 'shortcut',
        risk: write ? 'write' : 'read',
        identities: ['user', 'bot'],
        scopes: [`board:whiteboard:node:${write ? 'create' : 'read'}`],
        description: write
            ? 'Update whiteboard nodes or import a diagram.'
            : 'Export whiteboard preview, SVG, source or raw nodes. Output files become grant-owned artifacts requiring artifact write permission.',
        inputSchema: write
            ? update
            : {
                  type: 'object',
                  required: [
                      'whiteboard-token',
                      legacy ? 'output_as' : 'output-type',
                  ],
                  additionalProperties: false,
                  properties: {
                      'whiteboard-token': text,
                      [legacy ? 'output_as' : 'output-type']: {
                          enum: legacy
                              ? ['image', 'svg', 'code', 'raw']
                              : ['preview', 'svg', 'source', 'raw'],
                      },
                      output: text,
                      overwrite: { type: 'boolean' },
                  },
              },
    };
});

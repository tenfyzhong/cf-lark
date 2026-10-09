import type { CommandDefinition } from '../../domain/models';
export const docsScriptDefinition: CommandDefinition = {
    id: 'docs.+script',
    domain: 'docs',
    source: 'shortcut',
    risk: 'read',
    identities: ['user', 'bot'],
    scopes: [],
    description:
        'Parse document XML with the pinned Lark parser and assess a Presentation Decision. Workspaces use private artifact handles.',
    inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['command'],
        properties: {
            command: { enum: ['init-draft', 'parse'] },
            content: { type: 'string' },
            doc: { type: 'string' },
            'presentation-decision': { type: 'string' },
            workspace: { type: 'string' },
        },
    },
};

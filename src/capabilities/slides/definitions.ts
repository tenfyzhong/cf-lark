import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string', minLength: 1 };
export const presentationAliases = [
    'presentation',
    'presentation-id',
    'presentation-token',
    'token',
    'presentation_id',
    'xml-presentation-id',
    'url',
];
const presentation = Object.fromEntries(
    presentationAliases.map((k) => [k, text]),
);
const schemas: Record<string, JsonObject> = {
    'history-list': {
        'page-size': { type: 'integer', minimum: 1, maximum: 20 },
        'page-token': text,
    },
    'history-revert': { 'history-version-id': text },
    'history-revert-status': { 'task-id': text },
    'delete-slide': {
        'slide-id': text,
        'revision-id': { type: 'integer', minimum: -1 },
    },
    'xml-get': {
        'slide-id': text,
        'slide-number': { type: 'integer', minimum: 1 },
        'revision-id': { type: 'integer', minimum: -1 },
        'remove-attr-id': { type: 'boolean' },
        raw: { type: 'boolean' },
        output: text,
    },
};
export const slidesDefinitions: CommandDefinition[] = Object.entries(
    schemas,
).map(([name, properties]) => ({
    id: `slides.+${name}`,
    domain: 'slides',
    source: 'shortcut',
    risk: ['history-revert', 'delete-slide'].includes(name) ? 'write' : 'read',
    identities: ['user', 'bot'],
    scopes:
        name === 'history-revert' || name === 'delete-slide'
            ? ['slides:presentation:update', 'slides:presentation:write_only']
            : ['slides:presentation:read'],
    description: `${name.replaceAll('-', ' ')} for a Slides presentation. Accepts a token, Slides URL or Wiki URL; Wiki resolution requires wiki:node:read. Output files use private artifacts.`,
    inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { ...presentation, ...properties },
    },
}));

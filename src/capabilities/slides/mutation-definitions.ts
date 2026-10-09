import type { CommandDefinition, JsonObject } from '../../domain/models';
import { presentationAliases } from './definitions.ts';
const text = { type: 'string', minLength: 1 };
const common = {
    ...Object.fromEntries(presentationAliases.map((k) => [k, text])),
    'revision-id': { type: 'integer', minimum: -1 },
    'no-lint': { type: 'boolean' },
};
const schemas: Record<string, JsonObject> = {
    'add-slide': { slide: text, 'before-slide-id': text },
    'update-slide': {
        'slide-id': text,
        content: text,
        xml: text,
        'slide-xml': text,
        'slide-content': text,
        'content-xml': text,
        tid: text,
    },
    update: {
        'slide-id': text,
        content: text,
        xml: text,
        'slide-xml': text,
        'slide-content': text,
        'content-xml': text,
        tid: text,
    },
    'replace-slide': { 'slide-id': text, parts: { type: 'string' }, tid: text },
};
export const slidesMutationDefinitions: CommandDefinition[] = Object.entries(
    schemas,
).map(([name, props]) => ({
    id: `slides.+${name}`,
    domain: 'slides',
    source: 'shortcut',
    risk: 'write',
    identities: ['user', 'bot'],
    scopes: ['slides:presentation:update', 'slides:presentation:write_only'],
    description: `${name} with XML validation, explicit lint and revision locking. Read the full page before replacing it.`,
    inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { ...common, ...props },
    },
}));

import type { CommandDefinition, JsonObject } from '../../domain/models';
import { presentationAliases } from './definitions.ts';
const text = { type: 'string', minLength: 1 };
const refs = Object.fromEntries(presentationAliases.map((k) => [k, text]));
const schemas: Record<string, JsonObject> = {
    create: {
        title: { type: 'string' },
        slides: text,
        slide: { type: 'array', items: text, maxItems: 10 },
        'no-lint': { type: 'boolean' },
    },
    'replace-pages': {
        ...refs,
        pages: text,
        'continue-on-error': { type: 'boolean' },
        'validate-only': { type: 'boolean' },
        'no-lint': { type: 'boolean' },
    },
    'media-upload': { ...refs, file: text },
};
export const slidesWorkflowDefinitions: CommandDefinition[] = Object.entries(
    schemas,
).map(([name, properties]) => ({
    id: `slides.+${name}`,
    domain: 'slides',
    source: 'shortcut',
    risk: 'write',
    identities: ['user', 'bot'],
    scopes:
        name === 'media-upload'
            ? ['docs:document.media:upload', 'wiki:node:read']
            : [
                  'slides:presentation:write_only',
                  ...(name === 'create' ? ['docs:document.media:upload'] : []),
                  name === 'create'
                      ? 'slides:presentation:create'
                      : 'slides:presentation:update',
              ],
    description: `${name} with resumable checkpoints. Call workflow.resume until completed. File inputs and @image placeholders are private artifact IDs.`,
    inputSchema: { type: 'object', additionalProperties: false, properties },
}));

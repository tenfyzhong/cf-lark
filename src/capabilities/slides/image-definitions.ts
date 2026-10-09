import type { CommandDefinition } from '../../domain/models';
import { presentationAliases } from './definitions.ts';
const text = { type: 'string' };
const ids = { anyOf: [text, { type: 'array', items: text }] };
const numbers = {
    anyOf: [{ type: 'integer' }, { type: 'array', items: { type: 'integer' } }],
};
export const slidesImageDefinitions: CommandDefinition[] = [
    {
        id: 'slides.+screenshot',
        domain: 'slides',
        source: 'shortcut',
        risk: 'read',
        identities: ['user', 'bot'],
        scopes: ['slides:presentation:screenshot'],
        description:
            'Render slide XML or screenshot up to ten existing pages into private artifacts. Requires artifact write permission.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                ...Object.fromEntries(
                    presentationAliases.map((k) => [k, text]),
                ),
                'slide-id': ids,
                'slide-ids': ids,
                slides: ids,
                'slide-number': numbers,
                'slide-numbers': numbers,
                slide: text,
                content: text,
                output: text,
                'output-dir': text,
                'output-name': text,
            },
        },
    },
    {
        id: 'slides.+media-download',
        domain: 'slides',
        source: 'shortcut',
        risk: 'read',
        identities: ['user', 'bot'],
        scopes: ['docs:document.media:download'],
        description:
            'Download Slides image media to a private artifact, with source-preview fallback for permission denial. Requires artifact write permission.',
        inputSchema: {
            type: 'object',
            required: ['file-token'],
            additionalProperties: false,
            properties: {
                'file-token': text,
                output: text,
                'output-dir': text,
            },
        },
    },
];

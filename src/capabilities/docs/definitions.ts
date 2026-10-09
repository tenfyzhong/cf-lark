import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string' };
const integer = { type: 'integer' };
const schemas: Record<string, JsonObject> = {
    search: {
        query: text,
        filter: text,
        'page-token': text,
        'page-size': { anyOf: [text, integer] },
    },
    fetch: {
        'api-version': text,
        format: { enum: ['json', 'pretty', 'table', 'ndjson', 'csv'] },
        json: { type: 'boolean' },
        offset: text,
        limit: text,
        doc: text,
        'doc-format': { enum: ['xml', 'markdown', 'im-markdown'] },
        detail: { enum: ['simple', 'with-ids', 'full'] },
        lang: text,
        'revision-id': integer,
        scope: { enum: ['full', 'outline', 'section', 'range', 'keyword'] },
        'start-block-id': text,
        'end-block-id': text,
        keyword: text,
        'context-before': integer,
        'context-after': integer,
        'max-depth': integer,
    },
    update: {
        'api-version': text,
        format: { enum: ['json', 'pretty', 'table', 'ndjson', 'csv'] },
        json: { type: 'boolean' },
        mode: text,
        markdown: text,
        'selection-with-ellipsis': text,
        'selection-by-title': text,
        'new-title': text,
        doc: text,
        command: {
            enum: [
                'str_replace',
                'block_delete',
                'block_insert_after',
                'block_copy_insert_after',
                'block_replace',
                'block_move_after',
                'overwrite',
                'append',
            ],
        },
        content: text,
        'doc-format': { enum: ['xml', 'markdown'] },
        'reference-map': text,
        pattern: text,
        'block-id': text,
        'start-block-id': text,
        'end-block-id': text,
        'src-block-ids': text,
        'revision-id': integer,
    },
    'history-list': {
        doc: text,
        'page-size': { type: 'integer', minimum: 1, maximum: 20 },
        'page-token': text,
    },
    'history-revert': {
        doc: text,
        'history-version-id': text,
        'wait-timeout-ms': { type: 'integer', minimum: 0, maximum: 30000 },
    },
    'history-revert-status': { doc: text, 'task-id': text },
};
export const docsDefinitions: CommandDefinition[] = Object.entries(schemas).map(
    ([name, props]) => ({
        id: `docs.+${name}`,
        domain: 'docs',
        source: 'shortcut',
        risk: ['update', 'history-revert'].includes(name) ? 'write' : 'read',
        identities: name === 'search' ? ['user'] : ['user', 'bot'],
        scopes:
            name === 'search'
                ? ['search:docs:read']
                : [
                      'docx:document:readonly',
                      ...(['update', 'history-revert'].includes(name)
                          ? ['docx:document:write_only']
                          : []),
                  ],
        description: `${name.replaceAll('-', ' ')} Lark documents with CLI flag semantics, scope validation and structured output.`,
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: props,
            required: name === 'search' ? [] : ['doc'],
        },
    }),
);

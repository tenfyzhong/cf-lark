import type { DocumentParser } from '../../ports/document-parser';
import { authorize } from '../../domain/authorization';
import type { ArtifactStore } from '../../ports/artifacts';
import { exportDocumentResources } from './resources';
import { toIMMarkdown } from './im-markdown';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { docsDefinitions } from './definitions';
const fail = (message: string): never => {
    throw new ServiceError('INVALID_ARGUMENTS', message);
};
export function documentRef(value: unknown): {
    kind: string;
    token: string;
    fragment: string;
} {
    const raw = String(value ?? '').trim();
    if (!raw || /[\x00-\x1f\x7f]/u.test(raw))
        fail('A safe document locator is required.');
    const match = /\/(docx|doc|wiki)\/([^/?#]+)/u.exec(raw);
    if (match)
        return {
            kind: match[1]!,
            token: match[2]!,
            fragment: raw.split('#')[1] ?? '',
        };
    if (raw.includes('://') || /[/?#]/u.test(raw))
        fail('Use a Docx token or document URL.');
    return { kind: 'docx', token: raw, fragment: '' };
}
function required(args: JsonObject, key: string): string {
    const v = String(args[key] ?? '').trim();
    if (!v) fail(`${key} is required.`);
    return v;
}
function objectJSON(raw: unknown, label: string): JsonObject {
    let value: unknown;
    try {
        value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        return fail(`${label} must contain valid JSON.`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail(`${label} must be a JSON object.`);
    return value as JsonObject;
}
function search(args: JsonObject): ApiRequest {
    const n = Number(args['page-size'] ?? 15);
    const size = Number.isInteger(n) && n > 0 ? Math.min(20, n) : 15;
    const filter = args.filter ? objectJSON(args.filter, 'filter') : {};
    for (const key of ['open_time', 'create_time']) {
        const value = filter[key];
        if (!value || typeof value !== 'object' || Array.isArray(value))
            continue;
        const range: JsonObject = {};
        for (const k of ['start', 'end']) {
            const text = (value as JsonObject)[k];
            if (typeof text !== 'string' || !text) continue;
            const parsed = /^[+-]?\d+$/u.test(text)
                ? Number(text)
                : Date.parse(
                      /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/u.test(
                          text,
                      )
                          ? text.replace(' ', 'T') +
                                (text.length === 10 ? 'T00:00:00Z' : 'Z')
                          : text,
                  ) / 1000;
            if (!Number.isSafeInteger(parsed))
                fail(`Invalid ${key}.${k} timestamp.`);
            range[k] = parsed;
        }
        filter[key] = range;
    }
    const folder =
        Array.isArray(filter.folder_tokens) && filter.folder_tokens.length > 0;
    const space =
        Array.isArray(filter.space_ids) && filter.space_ids.length > 0;
    if (folder && space)
        fail('folder_tokens and space_ids cannot be combined.');
    const doc = { ...filter };
    delete doc.space_ids;
    const wiki = { ...filter };
    delete wiki.folder_tokens;
    return {
        method: 'POST',
        path: '/open-apis/search/v2/doc_wiki/search',
        body: {
            query: args.query ?? '',
            page_size: size,
            ...(args['page-token'] ? { page_token: args['page-token'] } : {}),
            ...(!space ? { doc_filter: doc } : {}),
            ...(!folder ? { wiki_filter: wiki } : {}),
        },
    };
}
function fetchBody(args: JsonObject, fragment: string): JsonObject {
    const format = String(args['doc-format'] ?? 'xml');
    if (!['xml', 'markdown', 'im-markdown'].includes(format))
        fail('Invalid doc-format.');
    const detail = String(args.detail ?? 'simple');
    if (!['simple', 'with-ids', 'full'].includes(detail))
        fail('Invalid detail.');
    const body: JsonObject = {
        format: format === 'im-markdown' ? 'markdown' : format,
        extra_param:
            '{"enable_user_cite_reference_map":true,"include_comments":true,"return_html5_block_data":true}',
        export_option:
            detail === 'with-ids' && format === 'xml'
                ? { export_block_id: true }
                : {
                      export_block_id: detail === 'full' && format === 'xml',
                      export_style_attrs: detail === 'full' && format === 'xml',
                      export_cite_extra_data:
                          detail === 'full' && format === 'xml',
                  },
    };
    if (Number(args['revision-id']) > 0) body.revision_id = args['revision-id'];
    if (args.lang) body.lang = String(args.lang).trim();
    let mode = String(args.scope ?? 'full');
    let start = String(args['start-block-id'] ?? '').trim();
    const end = String(args['end-block-id'] ?? '').trim();
    if (
        args['start-block-id'] === undefined &&
        args['end-block-id'] === undefined &&
        (args.scope === undefined || mode === 'range') &&
        /^share-.+/u.test(fragment)
    ) {
        mode = 'range';
        start = fragment;
    }
    if (!['full', 'outline', 'range', 'keyword', 'section'].includes(mode))
        fail('Invalid scope.');
    if (mode === 'full') return body;
    for (const key of ['context-before', 'context-after', 'max-depth']) {
        const v = args[key] ?? (key === 'max-depth' ? -1 : 0);
        if (!Number.isInteger(v) || Number(v) < (key === 'max-depth' ? -1 : 0))
            fail(`Invalid ${key}.`);
    }
    if (mode === 'range' && !start && !end)
        fail('range needs a start or end block.');
    if (mode === 'section' && !start) fail('section needs a start block.');
    if (mode === 'keyword' && !String(args.keyword ?? '').trim())
        fail('keyword scope needs a keyword.');
    const read: JsonObject = {
        read_mode: mode,
        ...(start ? { start_block_id: start } : {}),
        ...(end ? { end_block_id: end } : {}),
        ...(args.keyword ? { keyword: String(args.keyword).trim() } : {}),
    };
    for (const key of ['context-before', 'context-after', 'max-depth'])
        if (Number(args[key]) > (key === 'max-depth' ? -1 : 0))
            read[key.replaceAll('-', '_')] = String(args[key]);
    body.read_option = read;
    return body;
}
function updateBody(args: JsonObject): JsonObject {
    const command = required(args, 'command');
    if (
        ![
            'str_replace',
            'block_delete',
            'block_insert_after',
            'block_copy_insert_after',
            'block_replace',
            'block_move_after',
            'overwrite',
            'append',
        ].includes(command)
    )
        fail('Invalid update command.');
    const content = String(args.content ?? '');
    const block = String(args['block-id'] ?? '').trim();
    const start = String(args['start-block-id'] ?? '').trim();
    const end = String(args['end-block-id'] ?? '').trim();
    const range = !!(start || end);
    const mutation = ['block_delete', 'block_replace'].includes(command);
    if (range && !mutation)
        fail('Block ranges only apply to delete or replace.');
    if (
        mutation &&
        ((block && range) ||
            (!block && !range) ||
            (range && (!start || !end)) ||
            start === '-1' ||
            end === '0')
    )
        fail('Provide one valid block target or complete inclusive range.');
    if (command === 'str_replace' && !args.pattern)
        fail('str_replace requires pattern.');
    if (['block_delete', 'block_move_after'].includes(command) && content)
        fail(`${command} does not accept content.`);
    if (
        [
            'block_insert_after',
            'block_copy_insert_after',
            'block_move_after',
        ].includes(command) &&
        !block
    )
        fail('A block-id is required.');
    if (
        ['block_copy_insert_after', 'block_move_after'].includes(command) &&
        !args['src-block-ids']
    )
        fail('Source block IDs are required.');
    if (
        ['block_insert_after', 'block_replace', 'overwrite', 'append'].includes(
            command,
        ) &&
        !content
    )
        fail('Content is required.');
    const format = args['doc-format'] ?? 'xml';
    if (!['xml', 'markdown'].includes(String(format)))
        fail('Invalid doc-format.');
    const body: JsonObject = {
        format,
        command: command === 'append' ? 'block_insert_after' : command,
    };
    const revision = args['revision-id'] ?? -1;
    if (revision !== 0) body.revision_id = revision;
    if (content) body.content = content;
    if (args.pattern) body.pattern = args.pattern;
    if (command === 'append') body.block_id = '-1';
    else if (block) body.block_id = args['block-id'];
    for (const key of ['start-block-id', 'end-block-id', 'src-block-ids'])
        if (args[key]) body[key.replaceAll('-', '_')] = args[key];
    if (args['reference-map'] !== undefined) {
        if (
            !content ||
            ![
                'str_replace',
                'block_insert_after',
                'block_replace',
                'overwrite',
                'append',
            ].includes(command)
        )
            fail('reference-map requires an operation with content.');
        body.reference_map = objectJSON(args['reference-map'], 'reference-map');
    }
    return body;
}
export function prepareDocsRequest(name: string, args: JsonObject): ApiRequest {
    if (name === 'search') return search(args);
    const legacy =
        name === 'fetch'
            ? ['offset', 'limit']
            : name === 'update'
              ? [
                    'mode',
                    'markdown',
                    'selection-with-ellipsis',
                    'selection-by-title',
                    'new-title',
                ]
              : [];
    const used = legacy.filter((key) => args[key] !== undefined);
    if (used.length)
        fail(
            `The legacy v1 document interface is unavailable: ${used.join(', ')}. Use the current scope or command flags.`,
        );
    const ref = documentRef(args.doc);
    const path = `/open-apis/docs_ai/v1/documents/${encodeURIComponent(ref.token)}`;
    if (name === 'fetch')
        return {
            method: 'POST',
            path: `${path}/fetch`,
            body: fetchBody(args, ref.fragment),
        };
    if (name === 'update')
        return { method: 'PATCH', path, body: updateBody(args) };
    if (ref.kind === 'doc') fail('History requires Docx documents.');
    if (name === 'history-list') {
        const size = args['page-size'] ?? 20;
        if (!Number.isInteger(size) || Number(size) < 1 || Number(size) > 20)
            fail('page-size must be between 1 and 20.');
        return {
            method: 'GET',
            path: `${path}/histories`,
            query: {
                page_size: size,
                ...(args['page-token']
                    ? { page_token: String(args['page-token']).trim() }
                    : {}),
            },
        };
    }
    if (name === 'history-revert-status')
        return {
            method: 'GET',
            path: `${path}/history/revert_status`,
            query: { task_id: required(args, 'task-id') },
        };
    const version = required(args, 'history-version-id');
    if (
        !/^\+?\d+$/u.test(version) ||
        BigInt(version) < 1n ||
        BigInt(version) > 9223372036854775807n
    )
        fail('Version must be a positive int64 string.');
    const wait = args['wait-timeout-ms'] ?? 30000;
    if (!Number.isInteger(wait) || Number(wait) < 0 || Number(wait) > 30000)
        fail('wait-timeout-ms must be between 0 and 30000.');
    return {
        method: 'POST',
        path: `${path}/history/revert`,
        body: { history_version_id: version, wait_timeout_ms: wait },
    };
}
function times(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(times);
    if (!value || typeof value !== 'object') return value;
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
        result[key] = times(item);
        if (
            key.endsWith('_time') &&
            (typeof item === 'number' || typeof item === 'string')
        ) {
            const n = Number(item);
            const date = new Date(
                (n >= 1e12 ? Math.trunc(n / 1000) : Math.trunc(n)) * 1000,
            );
            if (Number.isFinite(date.getTime()))
                result[`${key}_iso`] = date.toISOString().replace('.000Z', 'Z');
        }
    }
    return result;
}
export function docsCapabilities(
    artifacts?: ArtifactStore,
    parser?: DocumentParser,
): Capability[] {
    return docsDefinitions.map((definition) => {
        const name = definition.id.slice(6);
        return {
            definition,
            preview: async (args) => prepareDocsRequest(name, args),
            execute: async (args, context) => {
                const data = await context.lark.request(
                    prepareDocsRequest(name, args),
                );
                if (name === 'search')
                    return {
                        total: data.total,
                        has_more: data.has_more,
                        page_token: data.page_token,
                        results: times(data.res_units ?? []),
                        ...(data.notice ? { notice: data.notice } : {}),
                    };
                if (
                    name === 'fetch' &&
                    args['doc-format'] &&
                    args['doc-format'] !== 'xml' &&
                    ['full', 'with-ids'].includes(String(args.detail))
                )
                    data.warnings = [
                        ...(Array.isArray(data.warnings) ? data.warnings : []),
                        `Detail ${args.detail} is only supported for XML; returning simple ${args['doc-format']}.`,
                    ];
                if (name === 'fetch')
                    await exportDocumentResources(
                        data,
                        String(args['doc-format'] ?? 'xml'),
                        async (html) => {
                            authorize(
                                context.grant,
                                {
                                    ...context.selection,
                                    domain: 'artifact',
                                    risk: 'write',
                                },
                                Date.now(),
                            );
                            if (!artifacts)
                                throw new ServiceError(
                                    'ARTIFACT_UNAVAILABLE',
                                    'HTML resource storage is unavailable.',
                                    500,
                                );
                            const blob = new Blob([html]);
                            return (
                                await artifacts.upload(
                                    context.grant.id,
                                    blob.size,
                                    blob.stream(),
                                )
                            ).id;
                        },
                    );
                if (name === 'fetch' && args['doc-format'] === 'im-markdown') {
                    const document = data.document;
                    if (
                        document &&
                        typeof document === 'object' &&
                        !Array.isArray(document) &&
                        typeof (document as JsonObject).content === 'string'
                    )
                        (document as JsonObject).content = await (
                            parser?.toIMMarkdown?.bind(parser) ?? toIMMarkdown
                        )(
                            String((document as JsonObject).content),
                            String(args.doc),
                        );
                }
                if (
                    name === 'update' &&
                    String(data.result).toLowerCase() === 'failed'
                )
                    throw new ServiceError(
                        'UPSTREAM_ERROR',
                        'Document update failed.',
                        502,
                        { result: data },
                    );
                return data;
            },
        };
    });
}

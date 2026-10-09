import { documentCreateDefinition } from './definitions.ts';
import { ServiceError } from '../../domain/errors.ts';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest, LarkClient } from '../../ports/lark';

function object(value: unknown): JsonObject | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as JsonObject)
        : undefined;
}

export function prepareDocumentCreate(args: JsonObject): ApiRequest {
    const legacy = [
        'markdown',
        'folder-token',
        'wiki-node',
        'wiki-space',
    ].filter((key) => args[key] !== undefined);
    if (legacy.length)
        throw new ServiceError(
            'INVALID_ARGUMENTS',
            `The legacy document interface is unavailable: ${legacy.join(', ')}. Use content and parent-token or parent-position.`,
        );
    if (
        args['doc-format'] !== undefined &&
        !['xml', 'markdown'].includes(String(args['doc-format']))
    )
        throw new ServiceError('INVALID_ARGUMENTS', 'Invalid doc-format.');
    if (args.title !== undefined && !String(args.title).trim())
        throw new ServiceError('INVALID_ARGUMENTS', 'title must not be blank.');
    if (!String(args.title ?? '').trim() && !String(args.content ?? '').trim())
        throw new ServiceError(
            'INVALID_ARGUMENTS',
            'Provide title or content.',
        );
    if (
        args['parent-token'] !== undefined &&
        args['parent-position'] !== undefined
    )
        throw new ServiceError(
            'INVALID_ARGUMENTS',
            'Provide only one parent location.',
        );
    const escape = (text: string) =>
        text.replace(
            /[<>&"']/gu,
            (char) =>
                ({
                    '<': '&lt;',
                    '>': '&gt;',
                    '&': '&amp;',
                    '"': '&#34;',
                    "'": '&#39;',
                })[char]!,
        );
    if (args['reference-map'] !== undefined && !args.content)
        throw new ServiceError(
            'INVALID_ARGUMENTS',
            'reference-map requires content.',
        );
    let referenceMap: unknown;
    if (args['reference-map'] !== undefined) {
        try {
            referenceMap = JSON.parse(String(args['reference-map']));
        } catch {
            throw new ServiceError(
                'INVALID_ARGUMENTS',
                'reference-map must be valid JSON.',
            );
        }
        if (referenceMap !== null && !object(referenceMap))
            throw new ServiceError(
                'INVALID_ARGUMENTS',
                'reference-map must be an object.',
            );
    }
    const title =
        args.title === undefined
            ? ''
            : `<title>${escape(String(args.title))}</title>`;
    const content = [title, String(args.content ?? '')]
        .filter(Boolean)
        .join('\n');
    return {
        method: 'POST',
        path: '/open-apis/docs_ai/v1/documents',
        body: {
            format: args['doc-format'] ?? 'xml',
            content,
            ...(referenceMap ? { reference_map: referenceMap } : {}),
            extra_param: '{"open_create_async":true}',
            ...(args['parent-token'] === undefined
                ? {}
                : { parent_token: args['parent-token'] }),
            ...(args['parent-position'] === undefined
                ? {}
                : { parent_position: args['parent-position'] }),
        },
    };
}

async function complete(
    initial: JsonObject,
    client: LarkClient,
    pause: (ms: number) => Promise<void>,
): Promise<JsonObject> {
    const invalid = (): never => {
        throw new ServiceError(
            'INVALID_UPSTREAM_RESPONSE',
            'Document creation returned an invalid result. Do not repeat the create request.',
            502,
        );
    };
    let data = initial;
    const firstTask = object(data.task);
    if (firstTask) {
        const taskId = firstTask.task_id;
        if (typeof taskId !== 'string' || !taskId.trim()) invalid();
        for (let polls = 0; ; polls++) {
            const task = object(data.task) ?? invalid();
            if (
                !task ||
                (task.task_id !== undefined && task.task_id !== taskId)
            )
                invalid();
            const status = String(task.status ?? '')
                .trim()
                .toLowerCase();
            if (status === 'succeeded') {
                try {
                    data =
                        object(
                            JSON.parse(
                                String(object(task.result)?.create_document),
                            ),
                        ) ?? invalid();
                } catch {
                    invalid();
                }
                break;
            }
            if (status === 'failed' || status === 'expired')
                throw new ServiceError(
                    'UPSTREAM_ERROR',
                    'Document creation failed. Do not automatically repeat the create request.',
                    502,
                );
            if (status !== '' && status !== 'processing') invalid();
            if (polls >= 20)
                throw new ServiceError(
                    'OUTCOME_UNCERTAIN',
                    'Document creation is still processing. Do not repeat the create request.',
                    502,
                    { taskId },
                );
            if (polls > 0) {
                const delay = Number(task.poll_after_ms);
                await pause(
                    Number.isFinite(delay) && delay > 0
                        ? Math.min(10_000, Math.max(100, delay))
                        : 3000,
                );
            }
            data = await client.request({
                method: 'GET',
                path: `/open-apis/docs_ai/v1/async_tasks/${encodeURIComponent(String(taskId))}`,
            });
        }
    }
    if (
        String(data.result ?? '')
            .trim()
            .toLowerCase() === 'failed'
    )
        throw new ServiceError(
            'UPSTREAM_ERROR',
            'Document creation failed.',
            502,
        );
    if (
        typeof object(data.document)?.document_id !== 'string' ||
        !object(data.document)?.document_id
    )
        invalid();
    return data;
}

export function documentCreateCapability(
    pause: (ms: number) => Promise<void>,
): Capability {
    return {
        definition: documentCreateDefinition,
        preview: async (args) => ({
            ...prepareDocumentCreate(args),
            followUp: {
                method: 'GET',
                path: '/open-apis/docs_ai/v1/async_tasks/{task_id}',
                condition: 'An asynchronous task is returned.',
            },
        }),
        execute: async (args, context) =>
            complete(
                await context.lark.request(prepareDocumentCreate(args)),
                context.lark,
                pause,
            ),
    };
}

import { imageDimensions, normalizeImagePresentation } from './image-metadata';
import { ServiceError } from '../../domain/errors';
import { authorize } from '../../domain/authorization';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { RemoteFiles } from '../../ports/remote-files';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { documentCreateDefinition } from '../shortcuts/definitions';
import { prepareDocumentCreate } from '../shortcuts/documents';
import { docsDefinitions } from './definitions';
import { prepareDocsRequest } from './commands';
import { prepareDocumentResources, type DocumentResource } from './resources';
import { mediaUploadProgram, saveDownloadResponse } from '../files/index';
const obj = (v: unknown): JsonObject =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};
const fail = (message: string): never => {
    throw new ServiceError('INVALID_ARGUMENTS', message);
};
function prepare(name: string, args: JsonObject) {
    return name === 'create'
        ? prepareDocumentCreate(args)
        : prepareDocsRequest('update', args);
}
export function docsWritePrograms(
    files: ArtifactFiles,
    remote?: RemoteFiles,
): WorkflowProgram[] {
    const upload = mediaUploadProgram(files);
    return [
        {
            id: 'docs-write',
            version: 1,
            domain: 'docs',
            risk: 'write',
            identities: ['user', 'bot'],
            step: async (state, context) => {
                const args = obj(state.args);
                const name = String(state.name);
                const next = (changes: JsonObject) => ({
                    done: false as const,
                    state: { ...state, ...changes },
                });
                const resources = (state.resources ?? []) as DocumentResource[];
                const index = Number(state.index ?? 0);
                const result = obj(state.result);
                const doc = obj(result.document);
                const id = String(doc.document_id ?? '');
                const read = async (artifact: string) => {
                    authorize(
                        context.grant,
                        {
                            ...context.selection,
                            domain: 'artifact',
                            risk: 'read',
                        },
                        Date.now(),
                    );
                    const value = await files.stat(context.grant.id, artifact);
                    if (value.size > 20_000_000)
                        fail('Document input exceeds 20,000,000 bytes.');
                    return (
                        await files.read(context.grant.id, artifact)
                    ).text();
                };
                if (state.phase === 'start') {
                    for (const key of ['content', 'reference-map']) {
                        if (
                            typeof args[key] === 'string' &&
                            args[key].startsWith('@')
                        )
                            args[key] = await read(args[key].slice(1));
                    }
                    const request = prepare(name, args);
                    const body = obj(request.body);
                    const prepared = await prepareDocumentResources(
                        String(body.content ?? ''),
                        String(body.format ?? 'xml'),
                        obj(body.reference_map),
                        read,
                    );
                    if (prepared.resources.length > 128)
                        fail(
                            'Document write exceeds 128 resources; split the operation.',
                        );
                    if (
                        name === 'update' &&
                        prepared.resources.length &&
                        ![
                            'append',
                            'overwrite',
                            'block_insert_after',
                            'block_replace',
                        ].includes(String(args.command))
                    )
                        fail(
                            'Local resources require append, overwrite, block_insert_after or block_replace.',
                        );
                    body.content = prepared.content;
                    if (Object.keys(prepared.referenceMap).length)
                        body.reference_map = prepared.referenceMap;
                    const encoded = JSON.stringify(body);
                    if (
                        new TextEncoder().encode(encoded).byteLength >
                        20_000_000
                    )
                        fail(
                            'Prepared document input exceeds 20,000,000 bytes.',
                        );
                    const {
                        content: _content,
                        'reference-map': _reference,
                        ...remainingArgs
                    } = args;
                    return next({
                        args: remainingArgs,
                        request: { ...request, body },
                        resources: prepared.resources,
                        phase: 'preflight',
                        index: 0,
                    });
                }
                if (state.phase === 'preflight') {
                    const resource = resources[index];
                    if (!resource) return next({ phase: 'write', index: 0 });
                    if (resource.artifact) {
                        authorize(
                            context.grant,
                            {
                                ...context.selection,
                                domain: 'artifact',
                                risk: 'read',
                            },
                            Date.now(),
                        );
                        const value = await files.stat(
                            context.grant.id,
                            resource.artifact,
                        );
                        if (
                            resource.kind === 'image' &&
                            value.size > 20 * 1024 * 1024
                        )
                            fail('Document images must not exceed 20 MiB.');
                    }
                    if (resource.url) {
                        if (!remote)
                            fail('Remote image transfer is unavailable.');
                        const response = await remote!.stream(
                            resource.url,
                            20 * 1024 * 1024,
                        );
                        const artifact = await saveDownloadResponse(
                            files,
                            context,
                            response,
                            `image-${index + 1}`,
                        );
                        resources[index] = {
                            ...resource,
                            artifact: artifact.artifact_id,
                        };
                    }
                    const staged = resources[index]!;
                    if (staged.kind === 'image' && staged.artifact) {
                        const header = await files.read(
                            context.grant.id,
                            staged.artifact,
                            { offset: 0, length: 128 * 1024 },
                        );
                        const dimensions = imageDimensions(
                            new Uint8Array(await header.arrayBuffer()),
                        );
                        if (
                            !dimensions ||
                            dimensions.width <= 0 ||
                            dimensions.height <= 0
                        )
                            fail(
                                'Image is not a supported BMP, GIF, JPEG, PNG, TIFF or WebP image.',
                            );
                        resources[index] = {
                            ...staged,
                            presentation: normalizeImagePresentation(
                                staged.presentation,
                                dimensions!,
                            ),
                        };
                    }
                    return next({ resources, index: index + 1 });
                }
                if (state.phase === 'write') {
                    const request = obj(state.request);
                    const body = request.body;
                    const data = await context.lark.request({
                        ...request,
                        body,
                    } as any);
                    if (String(data.result).toLowerCase() === 'failed')
                        return { done: true, output: data };
                    const task = obj(data.task);
                    return next({
                        result: data,
                        ...(Object.keys(task).length
                            ? {
                                  phase: 'poll',
                                  taskId: String(task.task_id ?? '').trim(),
                                  polls: 0,
                              }
                            : { phase: 'correlate' }),
                    });
                }
                if (state.phase === 'poll') {
                    const task = obj(result.task);
                    if (!Object.keys(task).length)
                        throw new ServiceError(
                            'INVALID_UPSTREAM_RESPONSE',
                            'Document task response omitted task. Do not repeat the write.',
                            502,
                        );
                    if (
                        typeof state.taskId !== 'string' ||
                        !state.taskId ||
                        (task.task_id !== undefined &&
                            String(task.task_id).trim() !==
                                String(state.taskId).trim())
                    )
                        throw new ServiceError(
                            'INVALID_UPSTREAM_RESPONSE',
                            'Document task response is invalid. Do not repeat the write.',
                            502,
                        );
                    const status = String(task.status ?? '')
                        .trim()
                        .toLowerCase();
                    if (status === 'succeeded') {
                        let data: JsonObject;
                        try {
                            data = obj(
                                JSON.parse(
                                    String(obj(task.result).create_document),
                                ),
                            );
                        } catch {
                            throw new ServiceError(
                                'INVALID_UPSTREAM_RESPONSE',
                                'Document task result is invalid.',
                                502,
                            );
                        }
                        if (String(data.result).toLowerCase() === 'failed')
                            return { done: true, output: data };
                        return next({ result: data, phase: 'correlate' });
                    }
                    if (['failed', 'expired'].includes(status))
                        return {
                            done: true,
                            output: { ...result, result: 'failed' },
                        };
                    if (!['', 'processing'].includes(status))
                        throw new ServiceError(
                            'INVALID_UPSTREAM_RESPONSE',
                            'Unknown document task status.',
                            502,
                        );
                    if (Number(state.polls) > 100)
                        throw new ServiceError(
                            'OUTCOME_UNCERTAIN',
                            'Document creation remains pending; do not repeat the creation.',
                            502,
                            { taskId: state.taskId },
                        );
                    let polled: JsonObject;
                    try {
                        polled = await context.lark.request({
                            method: 'GET',
                            path: `/open-apis/docs_ai/v1/async_tasks/${encodeURIComponent(state.taskId)}`,
                        });
                    } catch (error) {
                        if (
                            error instanceof ServiceError &&
                            (error.code === 'UPSTREAM_UNAVAILABLE' ||
                                [429, 500, 502, 503, 504].includes(
                                    Number(error.details?.upstreamStatus),
                                ))
                        ) {
                            const retryAfter = Math.min(
                                10000,
                                Math.max(
                                    3000,
                                    Number(state.pollDelay ?? 0) * 2,
                                ),
                            );
                            return {
                                ...next({
                                    polls: Number(state.polls) + 1,
                                    pollDelay: retryAfter,
                                }),
                                retryAfter,
                            };
                        }
                        throw error;
                    }
                    const suggested = Number(obj(polled.task).poll_after_ms);
                    const retryAfter =
                        suggested > 0
                            ? Math.min(10000, Math.max(100, suggested))
                            : 3000;
                    return {
                        ...next({
                            result: polled,
                            polls: Number(state.polls) + 1,
                            pollDelay: retryAfter,
                        }),
                        retryAfter,
                    };
                }
                if (state.phase === 'correlate') {
                    if (!id)
                        throw new ServiceError(
                            'INVALID_UPSTREAM_RESPONSE',
                            'Document write returned no document ID. Do not repeat it.',
                            502,
                        );
                    const blocks = ((doc.new_blocks ?? []) as JsonObject[]).map(
                        (block) => ({
                            ...block,
                            block_id:
                                typeof block.block_id === 'string'
                                    ? block.block_id.trim()
                                    : block.block_id,
                            block_token:
                                typeof block.block_token === 'string'
                                    ? block.block_token.trim()
                                    : block.block_token,
                        }),
                    );
                    const idCounts = new Map<string, number>();
                    for (const block of blocks)
                        if (typeof block.block_id === 'string')
                            idCounts.set(
                                block.block_id,
                                (idCounts.get(block.block_id) ?? 0) + 1,
                            );
                    const markers = new Set(resources.map((r) => r.marker));
                    const unknown = blocks.some(
                        (b) =>
                            String(b.block_token ?? '').startsWith('@lcli_') &&
                            !markers.has(String(b.block_token)),
                    );
                    const cleanupAssigned = new Set<string>();
                    const outcomes = resources.map((resource) => {
                        const matches = blocks.filter(
                            (b) => b.block_token === resource.marker,
                        );
                        const b: JsonObject = matches[0] ?? {};
                        const valid =
                            !unknown &&
                            matches.length === 1 &&
                            typeof b.block_id === 'string' &&
                            b.block_id &&
                            (b.block_type === resource.kind ||
                                b.block_type ===
                                    (resource.kind === 'image' ? 27 : 23)) &&
                            idCounts.get(b.block_id) === 1;
                        const matchesKind = (block: JsonObject) =>
                            block.block_type === resource.kind ||
                            block.block_type ===
                                (resource.kind === 'image' ? 27 : 23);
                        const candidates =
                            !unknown &&
                            matches.length > 0 &&
                            matches.every(matchesKind)
                                ? [
                                      ...new Set(
                                          matches
                                              .map((block) =>
                                                  String(block.block_id ?? ''),
                                              )
                                              .filter(Boolean),
                                      ),
                                  ].filter(
                                      (blockId) =>
                                          !cleanupAssigned.has(blockId) &&
                                          blocks
                                              .filter(
                                                  (block) =>
                                                      block.block_id ===
                                                      blockId,
                                              )
                                              .every(matchesKind),
                                  )
                                : [];
                        if (!valid)
                            for (const blockId of candidates)
                                cleanupAssigned.add(blockId);
                        return {
                            ...resource,
                            blockId: valid ? b.block_id : candidates[0],
                            cleanupRemaining: valid ? [] : candidates.slice(1),
                            status: valid ? 'pending' : 'correlation_failed',
                        };
                    });
                    return next({ outcomes, phase: 'upload', index: 0 });
                }
                const outcomes = (state.outcomes ?? []) as JsonObject[];
                if (state.phase === 'upload') {
                    const item = outcomes[index]!;
                    if (!item)
                        return next({
                            phase: 'cleanup-check',
                            index: 0,
                            cleanupRevision: doc.revision_id,
                        });
                    if (item.status !== 'pending')
                        return next({ index: index + 1 });
                    const uploadState = state.uploadState ?? {
                        phase: 'start',
                        args: {
                            file: item.artifact,
                            'parent-node': item.blockId,
                            'parent-type':
                                item.kind === 'image'
                                    ? 'docx_image'
                                    : 'docx_file',
                            'doc-id': id,
                            ...(item.name ? { name: item.name } : {}),
                        },
                    };
                    try {
                        const step = await upload.step(
                            obj(uploadState),
                            context,
                        );
                        if (!step.done)
                            return next({ uploadState: step.state });
                        return next({
                            fileToken: obj(step.output).file_token,
                            uploadState: null,
                            uploadAttempts: 0,
                            phase: 'bind',
                        });
                    } catch (error) {
                        if (
                            error instanceof ServiceError &&
                            error.code === 'OUTCOME_UNCERTAIN'
                        )
                            throw error;
                        if (
                            error instanceof ServiceError &&
                            Number(state.uploadAttempts ?? 0) < 2 &&
                            ([1061045, 99991400].includes(
                                Number(error.details?.upstreamCode),
                            ) ||
                                [429, 500, 502, 503, 504].includes(
                                    Number(error.details?.upstreamStatus),
                                ))
                        )
                            return next({
                                uploadState,
                                uploadAttempts:
                                    Number(state.uploadAttempts ?? 0) + 1,
                            });
                        outcomes[index] = {
                            ...item,
                            status: 'upload_failed',
                            error:
                                error instanceof Error
                                    ? error.message
                                    : 'Upload failed.',
                        };
                        return next({
                            outcomes,
                            index: index + 1,
                            uploadState: null,
                        });
                    }
                }
                if (state.phase === 'bind') {
                    const item = outcomes[index]!;
                    const replacement: JsonObject = { token: state.fileToken };
                    const presentation = obj(item.presentation);
                    if (item.kind === 'image') {
                        for (const key of ['width', 'height', 'scale'])
                            if (Number(presentation[key]) > 0)
                                replacement[key] = Number(presentation[key]);
                        if (
                            ['left', 'center', 'right'].includes(
                                String(presentation.align),
                            )
                        )
                            replacement.align = {
                                left: 1,
                                center: 2,
                                right: 3,
                            }[String(presentation.align) as 'left'];
                    }
                    try {
                        const binding = await context.lark.request({
                            method: 'PATCH',
                            path: `/open-apis/docx/v1/documents/${encodeURIComponent(id)}/blocks/batch_update`,
                            query: { document_revision_id: -1 },
                            body: {
                                requests: [
                                    {
                                        block_id: item.blockId,
                                        [item.kind === 'image'
                                            ? 'replace_image'
                                            : 'replace_file']: replacement,
                                    },
                                ],
                            },
                        });
                        if (
                            Number.isSafeInteger(
                                binding.document_revision_id,
                            ) &&
                            Number(binding.document_revision_id) >= 0
                        )
                            doc.revision_id = binding.document_revision_id;
                        outcomes[index] = {
                            ...item,
                            status: 'bound',
                            file_token: state.fileToken,
                        };
                    } catch (error) {
                        if (
                            error instanceof ServiceError &&
                            error.code === 'OUTCOME_UNCERTAIN'
                        )
                            throw error;
                        outcomes[index] = {
                            ...item,
                            status: 'bind_failed',
                            file_token: state.fileToken,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : 'Binding failed.',
                        };
                        return next({
                            outcomes,
                            phase: 'verify-bind',
                            bindRetryable:
                                error instanceof ServiceError &&
                                [429, 500, 502, 503, 504].includes(
                                    Number(error.details?.upstreamStatus),
                                ),
                        });
                    }
                    return next({
                        outcomes,
                        index: index + 1,
                        phase: 'upload',
                        fileToken: null,
                    });
                }
                if (state.phase === 'verify-bind') {
                    const item = outcomes[index]!;
                    try {
                        const data = await context.lark.request({
                            method: 'GET',
                            path: `/open-apis/docx/v1/documents/${encodeURIComponent(id)}/blocks/${encodeURIComponent(String(item.blockId))}`,
                        });
                        const block = obj(data.block);
                        const token = String(
                            block.token ??
                                obj(block[String(item.kind)]).token ??
                                '',
                        );
                        if (token === item.file_token) {
                            outcomes[index] = {
                                ...item,
                                status: 'bound',
                                cleanup_status: 'not_needed',
                            };
                        } else if (token) {
                            outcomes[index] = {
                                ...item,
                                status: 'bind_conflict',
                                cleanup_status: 'skipped_conflict',
                            };
                        } else if (
                            state.bindRetryable &&
                            Number(state.bindAttempts ?? 0) < 2
                        )
                            return next({
                                phase: 'bind',
                                bindAttempts:
                                    Number(state.bindAttempts ?? 0) + 1,
                            });
                    } catch {
                        outcomes[index] = {
                            ...item,
                            status: 'bind_ambiguous',
                            cleanup_status: 'skipped_ambiguous',
                        };
                    }
                    return next({
                        outcomes,
                        index: index + 1,
                        phase: 'upload',
                        bindAttempts: 0,
                        fileToken: null,
                    });
                }
                const cleanupNext = (changes: JsonObject = {}) => {
                    const item = outcomes[index]!;
                    const remaining = (item.cleanupRemaining ?? []) as string[];
                    const history = [
                        ...((item.cleanup_results ?? []) as JsonObject[]),
                        { block_id: item.blockId, status: item.cleanup_status },
                    ];
                    outcomes[index] = {
                        ...item,
                        cleanup_results: history,
                        ...(remaining.length
                            ? {
                                  blockId: remaining[0],
                                  cleanupRemaining: remaining.slice(1),
                              }
                            : {}),
                    };
                    return next({
                        outcomes,
                        index: remaining.length ? index : index + 1,
                        phase: 'cleanup-check',
                        ...changes,
                    });
                };
                if (state.phase === 'cleanup-check') {
                    const item = outcomes[index];
                    if (!item) return next({ phase: 'permission' });
                    if (item.status === 'bound' || !item.blockId)
                        return next({ index: index + 1 });
                    if (
                        !Number.isSafeInteger(Number(state.cleanupRevision)) ||
                        Number(state.cleanupRevision) < 0
                    ) {
                        outcomes[index] = {
                            ...item,
                            cleanup_status: 'skipped_ambiguous',
                        };
                        return cleanupNext();
                    }
                    try {
                        const data = await context.lark.request({
                            method: 'GET',
                            path: `/open-apis/docx/v1/documents/${encodeURIComponent(id)}/blocks/${encodeURIComponent(String(item.blockId))}`,
                        });
                        const block = obj(data.block);
                        const token = String(
                            block.token ??
                                obj(block[String(item.kind)]).token ??
                                '',
                        );
                        if (
                            block.block_type !== item.kind &&
                            block.block_type !==
                                (item.kind === 'image' ? 27 : 23)
                        ) {
                            outcomes[index] = {
                                ...item,
                                cleanup_status: 'skipped_ambiguous',
                            };
                            return cleanupNext();
                        }
                        if (token) {
                            outcomes[index] =
                                token === item.file_token
                                    ? {
                                          ...item,
                                          status: 'bound',
                                          cleanup_status: 'not_needed',
                                      }
                                    : {
                                          ...item,
                                          status: 'bind_conflict',
                                          cleanup_status: 'skipped_conflict',
                                      };
                            return cleanupNext();
                        }
                        if (item.kind === 'file') {
                            const parent = String(block.parent_id ?? '');
                            if (
                                !parent ||
                                parent === id ||
                                parent === item.blockId
                            ) {
                                outcomes[index] = {
                                    ...item,
                                    cleanup_status: 'skipped_ambiguous',
                                };
                                return cleanupNext();
                            }
                            return next({
                                cleanupTarget: parent,
                                phase: 'cleanup-parent',
                            });
                        }
                        return next({
                            cleanupTarget: item.blockId,
                            phase: 'cleanup-delete',
                        });
                    } catch {
                        outcomes[index] = {
                            ...item,
                            cleanup_status: 'skipped_ambiguous',
                        };
                        return cleanupNext();
                    }
                }
                if (state.phase === 'cleanup-parent') {
                    const item = outcomes[index]!;
                    try {
                        const data = await context.lark.request({
                            method: 'GET',
                            path: `/open-apis/docx/v1/documents/${encodeURIComponent(id)}/blocks/${encodeURIComponent(String(state.cleanupTarget))}`,
                        });
                        const block = obj(data.block);
                        const children = block.children;
                        if (
                            block.block_id === state.cleanupTarget &&
                            [33, 'view', 'figure'].includes(
                                block.block_type as any,
                            ) &&
                            Array.isArray(children) &&
                            children.length === 1 &&
                            children[0] === item.blockId
                        )
                            return next({ phase: 'cleanup-delete' });
                    } catch {}
                    outcomes[index] = {
                        ...item,
                        cleanup_status: 'skipped_ambiguous',
                    };
                    return cleanupNext();
                }
                if (state.phase === 'cleanup-delete') {
                    const item = outcomes[index]!;
                    let revision: unknown;
                    try {
                        const data = await context.lark.request({
                            method: 'PATCH',
                            path: `/open-apis/docs_ai/v1/documents/${encodeURIComponent(id)}`,
                            body: {
                                format: 'xml',
                                command: 'block_delete',
                                block_id: state.cleanupTarget,
                                revision_id: state.cleanupRevision,
                            },
                        });
                        if (data.result === 'failed')
                            throw new Error('Cleanup rejected.');
                        revision = obj(data.document).revision_id;
                        outcomes[index] = {
                            ...item,
                            cleanup_status: 'succeeded',
                        };
                    } catch (error) {
                        if (
                            error instanceof ServiceError &&
                            error.code === 'OUTCOME_UNCERTAIN'
                        )
                            throw error;
                        outcomes[index] = { ...item, cleanup_status: 'failed' };
                    }
                    if (Number.isSafeInteger(revision) && Number(revision) >= 0)
                        doc.revision_id = revision;
                    return cleanupNext({ cleanupRevision: revision });
                }
                if (state.phase === 'permission') {
                    let permission: JsonObject | undefined;
                    if (
                        name === 'create' &&
                        context.selection.identity === 'bot'
                    ) {
                        const accounts =
                            context.grant.profiles.find(
                                (p) =>
                                    p.profileId === context.selection.profileId,
                            )?.accounts ?? [];
                        const user =
                            context.selection.accountId ??
                            (accounts.length === 1 ? accounts[0] : undefined);
                        permission = { status: 'skipped' };
                        if (user && accounts.includes(user)) {
                            try {
                                await context.lark.request({
                                    method: 'POST',
                                    path: `/open-apis/drive/v1/permissions/${encodeURIComponent(id)}/members`,
                                    query: {
                                        type: 'docx',
                                        need_notification: false,
                                    },
                                    body: {
                                        member_type: 'openid',
                                        member_id: user,
                                        perm: 'full_access',
                                        type: 'user',
                                    },
                                });
                                permission = {
                                    status: 'granted',
                                    member_id: user,
                                    perm: 'full_access',
                                };
                            } catch {
                                permission = {
                                    status: 'failed',
                                    member_id: user,
                                    perm: 'full_access',
                                };
                            }
                        }
                    }
                    return next({ phase: 'complete', permission });
                }
                if (state.phase === 'complete') {
                    const failures = outcomes
                        .filter((r) => r.status !== 'bound')
                        .map(({ marker: _, presentation: __, ...r }) => r);
                    const document: JsonObject = {
                        ...doc,
                        ...(!doc.url
                            ? {
                                  url: `https://${context.lark.brand === 'lark' ? 'www.larksuite.com' : 'www.feishu.cn'}/docx/${id}`,
                              }
                            : {}),
                    };
                    if (Array.isArray(document.new_blocks))
                        document.new_blocks = document.new_blocks.map((b) => {
                            const value = { ...obj(b) };
                            if (
                                String(value.block_token ?? '').startsWith(
                                    '@lcli_',
                                )
                            )
                                delete value.block_token;
                            return value;
                        });
                    return {
                        done: true,
                        output: {
                            ...result,
                            document,
                            ...(state.permission
                                ? { permission_grant: state.permission }
                                : {}),
                            ...(failures.length
                                ? {
                                      result: 'failed',
                                      resource_failures: failures,
                                  }
                                : {}),
                        },
                    };
                }
                throw new ServiceError(
                    'INVALID_WORKFLOW_STATE',
                    'Unknown document write phase.',
                    500,
                );
            },
        },
    ];
}
export function docsWriteCapabilities(workflows: WorkflowRunner): Capability[] {
    return [
        documentCreateDefinition,
        docsDefinitions.find((d) => d.id === 'docs.+update')!,
    ].map((definition) => ({
        definition,
        preview: async (args) => {
            const hydration = Object.values(args).some(
                (v) => typeof v === 'string' && v.startsWith('@'),
            );
            return hydration
                ? { operation: definition.id, artifact_inputs: true }
                : prepare(
                      definition.id === 'docs.+create' ? 'create' : 'update',
                      args,
                  );
        },
        execute: async (args, context) =>
            workflows.start(
                'docs-write',
                {
                    phase: 'start',
                    name:
                        definition.id === 'docs.+create' ? 'create' : 'update',
                    args,
                },
                context.selection,
                context.grant,
            ),
    }));
}

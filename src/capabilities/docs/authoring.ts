import { imageDimensions as dimensions } from './image-metadata';
import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { Capability } from '../../ports/capabilities';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import type { RemoteFiles } from '../../ports/remote-files';
import { mediaUploadProgram, saveDownloadResponse } from '../files/index';
import { documentRef } from './commands';
import { resolveDocx } from './media';
import { docsAuthoringDefinitions } from './authoring-definitions';
const obj = (value: unknown): JsonObject =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as JsonObject)
        : {};
const fail = (message: string): never => {
    throw new ServiceError('INVALID_ARGUMENTS', message);
};
function validate(command: string, args: JsonObject): void {
    if (documentRef(args.doc).kind === 'doc')
        fail('This operation requires Docx.');
    const source = [
        args.file,
        args['from-clipboard'] ? args['clipboard-artifact'] : undefined,
        args.url,
    ].filter((v) => typeof v === 'string' && v.trim());
    if (source.length !== 1)
        fail('Provide exactly one file, URL or clipboard artifact source.');
    if (args['from-clipboard'] && !args['clipboard-artifact'])
        fail('Hosted clipboard input requires clipboard-artifact.');
    if (args['clipboard-artifact'] && !args['from-clipboard'])
        fail('clipboard-artifact requires from-clipboard.');
    if (command === 'resource-update') {
        if (args.type !== undefined && args.type !== 'cover')
            fail('Only cover resources are supported.');
        for (const key of ['offset-ratio-x', 'offset-ratio-y'])
            if (args[key] !== undefined && !Number.isFinite(args[key]))
                fail(`${key} must be finite.`);
        if (args.url) {
            let url: URL;
            try {
                url = new URL(String(args.url));
            } catch {
                return fail('Invalid cover URL.');
            }
            if (url.protocol !== 'https:') fail('Cover URLs must use HTTPS.');
        }
        return;
    }
    const type = args.type ?? 'image';
    if (!['image', 'file'].includes(String(type))) fail('Invalid media type.');
    if (args.url) fail('media-insert requires an artifact source.');
    if (
        args['file-view'] !== undefined &&
        (type !== 'file' ||
            !['card', 'preview', 'inline'].includes(String(args['file-view'])))
    )
        fail('file-view requires file type and a known view.');
    for (const k of ['width', 'height'])
        if (
            args[k] !== undefined &&
            (type !== 'image' ||
                !Number.isSafeInteger(args[k]) ||
                Number(args[k]) < 1 ||
                Number(args[k]) > 10000)
        )
            fail(`Invalid image ${k}.`);
}
export function docsAuthoringPrograms(
    files: ArtifactFiles,
    remote?: RemoteFiles,
): WorkflowProgram[] {
    const uploader = mediaUploadProgram(files);
    return [
        {
            id: 'docs-media-authoring',
            version: 1,
            domain: 'docs',
            risk: 'write',
            identities: ['user', 'bot'],
            async step(state, context) {
                const args = obj(state.args);
                const command = String(state.command);
                const insert = command === 'media-insert';
                const id = String(state.documentId ?? '');
                const type = String(args.type ?? 'image');
                const next = (patch: JsonObject) => ({
                    done: false as const,
                    state: { ...state, ...patch },
                });
                const path = `/open-apis/docx/v1/documents/${encodeURIComponent(id)}`;
                if (state.phase === 'start') {
                    validate(command, args);
                    authorize(
                        context.grant,
                        {
                            ...context.selection,
                            domain: 'artifact',
                            risk: args.url ? 'write' : 'read',
                        },
                        Date.now(),
                    );
                    return next({
                        phase: args.url ? 'remote' : 'inspect',
                        file: args.file ?? args['clipboard-artifact'],
                    });
                }
                if (state.phase === 'remote') {
                    if (!remote)
                        throw new ServiceError(
                            'REMOTE_FILES_UNAVAILABLE',
                            'Remote file transport is unavailable.',
                        );
                    const response = await remote.stream(
                        String(args.url),
                        20 * 1024 * 1024,
                    );
                    const mime = response.headers
                        .get('content-type')
                        ?.split(';')[0]
                        ?.trim()
                        .toLowerCase();
                    if (
                        !mime ||
                        ![
                            'image/bmp',
                            'image/gif',
                            'image/jpeg',
                            'image/png',
                            'image/tiff',
                            'image/webp',
                        ].includes(mime)
                    )
                        fail(
                            'Cover URL Content-Type must be a supported image format.',
                        );
                    const saved = await saveDownloadResponse(
                        files,
                        context,
                        response,
                        'cover',
                    );
                    return next({ file: saved.artifact_id, phase: 'inspect' });
                }
                if (state.phase === 'inspect') {
                    authorize(
                        context.grant,
                        {
                            ...context.selection,
                            domain: 'artifact',
                            risk: 'read',
                        },
                        Date.now(),
                    );
                    const artifact = await files.stat(
                        context.grant.id,
                        String(state.file),
                    );
                    let width = args.width,
                        height = args.height;
                    if (
                        insert &&
                        type === 'image' &&
                        (width !== undefined || height !== undefined) &&
                        !(width && height)
                    ) {
                        const response = await files.read(
                            context.grant.id,
                            String(state.file),
                            {
                                offset: 0,
                                length: Math.min(artifact.size, 128 * 1024),
                            },
                        );
                        const d = dimensions(
                            new Uint8Array(await response.arrayBuffer()),
                        );
                        if (!d || d!.width < 1 || d!.height < 1)
                            fail(
                                'Cannot derive source image dimensions. Supply both dimensions or a supported PNG, JPEG or GIF.',
                            );
                        if (width)
                            height = Math.round(
                                (Number(width) * d!.height) / d!.width,
                            );
                        else
                            width = Math.round(
                                (Number(height) * d!.width) / d!.height,
                            );
                    }
                    return next({ width, height, phase: 'resolve' });
                }
                if (state.phase === 'resolve')
                    return next({
                        documentId: await resolveDocx(args, context),
                        phase: insert ? 'root' : 'upload',
                    });
                if (state.phase === 'root') {
                    const data = await context.lark.request({
                        method: 'GET',
                        path: `${path}/blocks/${encodeURIComponent(id)}`,
                    });
                    const block = obj(data.block);
                    if (!Object.keys(block).length)
                        throw new ServiceError(
                            'INVALID_UPSTREAM_RESPONSE',
                            'Document root block is missing.',
                            502,
                        );
                    return next({
                        parent: String(block.block_id ?? id),
                        index: Array.isArray(block.children)
                            ? block.children.length
                            : 0,
                        phase: 'placeholder',
                    });
                }
                if (state.phase === 'placeholder') {
                    const child =
                        type === 'file'
                            ? {
                                  block_type: 23,
                                  file: {
                                      ...(args['file-view']
                                          ? {
                                                view_type: (
                                                    {
                                                        card: 1,
                                                        preview: 2,
                                                        inline: 3,
                                                    } as Record<string, number>
                                                )[String(args['file-view'])],
                                            }
                                          : {}),
                                  },
                              }
                            : { block_type: 27, image: {} };
                    const data = await context.lark.request({
                        method: 'POST',
                        path: `${path}/blocks/${encodeURIComponent(String(state.parent))}/children`,
                        body: { children: [child], index: state.index },
                    });
                    const created = obj(
                        Array.isArray(data.children)
                            ? data.children[0]
                            : undefined,
                    );
                    if (
                        typeof created.block_id !== 'string' ||
                        !created.block_id
                    )
                        throw new ServiceError(
                            'OUTCOME_UNCERTAIN',
                            'Placeholder creation returned no block ID.',
                            502,
                        );
                    const nested =
                        type === 'file' &&
                        Array.isArray(created.children) &&
                        typeof created.children[0] === 'string'
                            ? created.children[0]
                            : created.block_id;
                    return next({
                        blockId: created.block_id,
                        target: nested,
                        phase: 'upload',
                    });
                }
                if (state.phase === 'upload') {
                    const input = state.uploadState
                        ? obj(state.uploadState)
                        : {
                              phase: 'start',
                              args: {
                                  file: state.file,
                                  'parent-node': insert ? state.target : id,
                                  'parent-type':
                                      insert && type === 'file'
                                          ? 'docx_file'
                                          : 'docx_image',
                                  'doc-id': id,
                              },
                          };
                    try {
                        const result = await uploader.step(input, context);
                        if (!result.done)
                            return next({ uploadState: result.state });
                        return next({
                            fileToken: obj(result.output).file_token,
                            phase: 'bind',
                        });
                    } catch (error) {
                        if (
                            !(error instanceof ServiceError) ||
                            error.code === 'OUTCOME_UNCERTAIN'
                        )
                            throw error;
                        return next({
                            error: { code: error.code, message: error.message },
                            phase: insert ? 'rollback-check' : 'complete',
                        });
                    }
                }
                if (state.phase === 'bind') {
                    const token = String(state.fileToken);
                    let body: JsonObject;
                    if (insert) {
                        const replacement: JsonObject = { token };
                        if (type === 'image') {
                            if (state.width) replacement.width = state.width;
                            if (state.height) replacement.height = state.height;
                            const align = (
                                { left: 1, center: 2, right: 3 } as Record<
                                    string,
                                    number
                                >
                            )[String(args.align)];
                            if (align) replacement.align = align;
                            if (args.caption)
                                replacement.caption = { content: args.caption };
                        }
                        body = {
                            requests: [
                                {
                                    block_id: state.target,
                                    [type === 'file'
                                        ? 'replace_file'
                                        : 'replace_image']: replacement,
                                },
                            ],
                        };
                    } else {
                        const cover: JsonObject = { token };
                        for (const key of ['offset-ratio-x', 'offset-ratio-y'])
                            if (args[key] !== undefined)
                                cover[key.replaceAll('-', '_')] = args[key];
                        body = { update_cover: { cover } };
                    }
                    try {
                        await context.lark.request({
                            method: 'PATCH',
                            path: insert ? `${path}/blocks/batch_update` : path,
                            body,
                        });
                        return next({ phase: 'complete' });
                    } catch (error) {
                        if (
                            !(error instanceof ServiceError) ||
                            error.code === 'OUTCOME_UNCERTAIN'
                        )
                            throw error;
                        return next({
                            error: { code: error.code, message: error.message },
                            phase: insert ? 'rollback-check' : 'complete',
                        });
                    }
                }
                if (state.phase === 'rollback-check') {
                    try {
                        const data = await context.lark.request({
                            method: 'GET',
                            path: `${path}/blocks/${encodeURIComponent(String(state.parent))}`,
                        });
                        const children = obj(data.block).children;
                        const index = Array.isArray(children)
                            ? children.indexOf(state.blockId)
                            : -1;
                        const revision = data.document_revision_id;
                        if (index < 0)
                            return next({
                                phase: 'complete',
                                rollback: 'already_absent',
                            });
                        if (
                            !Number.isSafeInteger(revision) ||
                            Number(revision) < 0
                        )
                            return next({
                                phase: 'complete',
                                rollback: 'skipped_ambiguous',
                            });
                        return next({
                            phase: 'rollback',
                            rollbackIndex: index,
                            rollbackRevision: revision,
                        });
                    } catch {
                        return next({
                            phase: 'complete',
                            rollback: 'skipped_ambiguous',
                        });
                    }
                }
                if (state.phase === 'rollback') {
                    let rollback = 'succeeded';
                    try {
                        await context.lark.request({
                            method: 'DELETE',
                            path: `${path}/blocks/${encodeURIComponent(String(state.parent))}/children/batch_delete`,
                            query: {
                                document_revision_id: state.rollbackRevision,
                            },
                            body: {
                                start_index: state.rollbackIndex,
                                end_index: Number(state.rollbackIndex) + 1,
                            },
                        });
                    } catch {
                        rollback = 'failed';
                    }
                    return next({ phase: 'complete', rollback });
                }
                if (state.phase === 'complete')
                    return {
                        done: true,
                        output: {
                            document_id: id,
                            type: insert ? type : 'cover',
                            ...(state.blockId
                                ? { block_id: state.blockId }
                                : {}),
                            ...(state.fileToken
                                ? { file_token: state.fileToken }
                                : {}),
                            ...(state.width ? { width: state.width } : {}),
                            ...(state.height ? { height: state.height } : {}),
                            ...(state.error
                                ? {
                                      status: 'failed',
                                      error: state.error,
                                      ...(state.rollback
                                          ? { rollback: state.rollback }
                                          : {}),
                                  }
                                : { updated: true }),
                        },
                    };
                throw new ServiceError(
                    'INVALID_WORKFLOW_STATE',
                    'Unknown document authoring phase.',
                    500,
                );
            },
        },
    ];
}
export function docsAuthoringCapabilities(
    workflows: WorkflowRunner,
): Capability[] {
    return docsAuthoringDefinitions.map((definition) => {
        const command = definition.id.slice(6);
        return {
            definition,
            preview: async (args) => {
                validate(command, args);
                return {
                    workflow: 'docs-media-authoring',
                    command,
                    document: documentRef(args.doc),
                    phases:
                        command === 'media-insert'
                            ? [
                                  'resolve',
                                  'read_root',
                                  'create_placeholder',
                                  'upload',
                                  'bind',
                                  'rollback_on_failure',
                              ]
                            : ['resolve', 'upload', 'update_cover'],
                };
            },
            execute: async (args, context) => {
                validate(command, args);
                return workflows.start(
                    'docs-media-authoring',
                    { phase: 'start', command, args },
                    context.selection,
                    context.grant,
                );
            },
        };
    });
}

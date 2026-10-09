import { ServiceError } from '../../domain/errors';
import { authorize } from '../../domain/authorization';
import type { JsonObject } from '../../domain/models';
import type { ArtifactStore } from '../../ports/artifacts';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { LarkTransferClient } from '../../ports/lark';
import { saveDownloadResponse } from '../files/index';
import { documentRef } from './commands';
import { docsMediaDefinitions } from './media-definitions';
const obj = (v: unknown): JsonObject =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
        ? (v as JsonObject)
        : {};
const fail = (message: string): never => {
    throw new ServiceError('INVALID_ARGUMENTS', message);
};
export async function resolveDocx(
    args: JsonObject,
    context: CommandContext,
): Promise<string> {
    const ref = documentRef(args.doc);
    if (ref.kind === 'doc')
        return fail('This operation requires a Docx document.');
    if (ref.kind !== 'wiki') return ref.token;
    const data = await context.lark.request({
        method: 'GET',
        path: '/open-apis/wiki/v2/spaces/node_by_token',
        query: { token: ref.token },
    });
    const node = obj(data.node);
    if (
        node.obj_type !== 'docx' ||
        typeof node.obj_token !== 'string' ||
        !node.obj_token
    )
        return fail('Wiki reference does not resolve to Docx.');
    return node.obj_token;
}
function validate(name: string, args: JsonObject): void {
    if (name.startsWith('resource-')) {
        if (documentRef(args.doc).kind === 'doc')
            fail('This operation requires Docx.');
        if (args.type !== undefined && args.type !== 'cover')
            fail('Only cover resources are supported.');
    } else {
        if (!/^[A-Za-z0-9_-]+$/u.test(String(args.token ?? '')))
            fail('A safe resource token is required.');
        if (
            name === 'media-download' &&
            args.type !== undefined &&
            !['media', 'whiteboard'].includes(String(args.type))
        )
            fail('Invalid media type.');
    }
    if (name !== 'resource-delete' && !String(args.output ?? '').trim())
        fail('output artifact name is required.');
}
export function docsMediaCapabilities(artifacts: ArtifactStore): Capability[] {
    return docsMediaDefinitions.map((definition) => {
        const name = definition.id.slice(6);
        return {
            definition,
            preview: async (args) => {
                validate(name, args);
                const token = name.startsWith('resource-')
                    ? documentRef(args.doc).token
                    : String(args.token);
                return {
                    operation: name,
                    token,
                    output: args.output,
                    ...(name === 'media-download' && args.type !== 'whiteboard'
                        ? {
                              permission: {
                                  method: 'GET',
                                  path: `/open-apis/drive/v1/permissions/${encodeURIComponent(token)}/members/auth`,
                                  query: { type: 'file', action: 'export' },
                              },
                          }
                        : {}),
                    ...(name.startsWith('resource-')
                        ? {
                              metadata: {
                                  method: 'GET',
                                  path: `/open-apis/docx/v1/documents/${encodeURIComponent(token)}`,
                              },
                          }
                        : {}),
                };
            },
            execute: async (args, context) => {
                validate(name, args);
                if (name !== 'resource-delete')
                    authorize(
                        context.grant,
                        {
                            ...context.selection,
                            domain: 'artifact',
                            risk: 'write',
                        },
                        Date.now(),
                    );
                let token = String(args.token ?? '');
                let cover: JsonObject | undefined;
                let documentId: string | undefined;
                if (name.startsWith('resource-')) {
                    documentId = await resolveDocx(args, context);
                    const data = await context.lark.request({
                        method: 'GET',
                        path: `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}`,
                    });
                    cover = obj(obj(data.document).cover);
                    if (!Object.keys(cover).length) cover = obj(data.cover);
                    token = String(cover.token ?? '');
                    if (name === 'resource-delete') {
                        if (!token)
                            return {
                                document_id: documentId,
                                type: 'cover',
                                deleted: false,
                                already_empty: true,
                            };
                        await context.lark.request({
                            method: 'PATCH',
                            path: `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}`,
                            body: { update_cover: { cover: null } },
                        });
                        return {
                            document_id: documentId,
                            type: 'cover',
                            deleted: true,
                            already_empty: false,
                            previous_cover: cover,
                        };
                    }
                    if (!token)
                        throw new ServiceError(
                            'NOT_FOUND',
                            'The document has no cover.',
                            404,
                        );
                }
                let warning: string | undefined;
                if (name === 'media-download' && args.type !== 'whiteboard') {
                    try {
                        const check = await context.lark.request({
                            method: 'GET',
                            path: `/open-apis/drive/v1/permissions/${encodeURIComponent(token)}/members/auth`,
                            query: { type: 'file', action: 'export' },
                        });
                        if (typeof check.auth_result !== 'boolean')
                            throw new ServiceError(
                                'INVALID_UPSTREAM_RESPONSE',
                                'Export permission result must contain auth_result.',
                                502,
                            );
                        if (!check.auth_result)
                            throw new ServiceError(
                                'FORBIDDEN',
                                'The selected identity cannot export this media.',
                                403,
                            );
                    } catch (error) {
                        if (
                            !(error instanceof ServiceError) ||
                            ![99991672, 99991676, 99991679].includes(
                                Number(error.details?.upstreamCode),
                            )
                        )
                            throw error;
                        warning =
                            'Export permission check lacked scope; download permission was checked by the download endpoint.';
                    }
                }
                const client = context.lark as LarkTransferClient;
                if (!client.download)
                    throw new ServiceError(
                        'TRANSFER_UNAVAILABLE',
                        'Binary download transport is required.',
                    );
                const path =
                    name === 'media-download' && args.type === 'whiteboard'
                        ? `/open-apis/board/v1/whiteboards/${encodeURIComponent(token)}/download_as_image`
                        : `/open-apis/drive/v1/medias/${encodeURIComponent(token)}/${name === 'media-preview' ? 'preview_download' : 'download'}`;
                const response = await client.download({ path });
                const result = await saveDownloadResponse(
                    artifacts,
                    context,
                    response,
                    String(args.output),
                );
                return {
                    ...result,
                    content_type: response.headers.get('content-type'),
                    ...(documentId
                        ? { document_id: documentId, type: 'cover', cover }
                        : {}),
                    ...(warning ? { warnings: [warning] } : {}),
                };
            },
        };
    });
}

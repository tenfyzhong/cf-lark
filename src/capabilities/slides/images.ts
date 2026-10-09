import { saveDownloadResponse } from '../files/index';
import { ServiceError } from '../../domain/errors';
import { authorize } from '../../domain/authorization';
import type { JsonObject } from '../../domain/models';
import type { ArtifactStore } from '../../ports/artifacts';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest, LarkTransferClient } from '../../ports/lark';
import { presentationAliases } from './definitions';
import { presentationRef, resolvePresentation } from './commands';
import { slidesImageDefinitions } from './image-definitions';
const fail = (message: string): never => {
    throw new ServiceError('INVALID_ARGUMENTS', message);
};
const invalid = (): never => {
    throw new ServiceError(
        'INVALID_UPSTREAM_RESPONSE',
        'Invalid Slides image response.',
        502,
    );
};
function output(args: JsonObject, count: number, render: boolean): void {
    if (args.output !== undefined) {
        const name = String(args.output);
        if (
            !name ||
            name !== name.trim() ||
            name.endsWith('/') ||
            (/\.[^./]+$/u.test(name) && !/\.(png|jpe?g)$/iu.test(name))
        )
            fail('output must name a PNG or JPEG image.');
        if (
            args['output-dir'] !== undefined ||
            args['output-name'] !== undefined ||
            count !== 1
        )
            fail(
                'output requires exactly one image and cannot be combined with output-dir or output-name.',
            );
    } else if (!render && args['output-name'] !== undefined)
        fail('output-name requires content render mode.');
}
function screenshot(args: JsonObject, id: string): ApiRequest {
    const ids = new Set<string>();
    const numbers = new Set<number>();
    for (const key of ['slide-id', 'slide-ids', 'slides'])
        if (args[key] !== undefined)
            for (const item of Array.isArray(args[key])
                ? (args[key] as unknown[])
                : [args[key]])
                for (const token of String(item).split(',')) {
                    if (!token.trim()) fail('Slide IDs cannot be empty.');
                    ids.add(token.trim());
                }
    for (const key of ['slide-number', 'slide-numbers'])
        if (args[key] !== undefined)
            for (const item of Array.isArray(args[key])
                ? (args[key] as unknown[])
                : [args[key]]) {
                if (!Number.isSafeInteger(item) || Number(item) < 1)
                    fail('Slide numbers must be positive integers.');
                numbers.add(Number(item));
            }
    if (args.slide !== undefined) {
        const v = String(args.slide).trim();
        if (/^\d+$/u.test(v)) {
            if (Number(v) < 1) fail('Slide number must be positive.');
            numbers.add(Number(v));
        } else if (v) ids.add(v);
        else fail('slide cannot be empty.');
    }
    if (ids.size && numbers.size)
        fail('Slide IDs and numbers cannot be mixed.');
    const render = args.content !== undefined;
    if (render) {
        if (
            !String(args.content).trim() ||
            ids.size ||
            numbers.size ||
            presentationAliases.some((k) => args[k] !== undefined)
        )
            fail(
                'Render content cannot be combined with a presentation or selectors.',
            );
        output(args, 1, true);
        return {
            method: 'POST',
            path: '/open-apis/slides_ai/v1/slide_image/render',
            body: { content: args.content },
        };
    }
    presentationRef(args);
    if (ids.size + numbers.size < 1 || ids.size + numbers.size > 10)
        fail('Select between one and ten slides.');
    output(args, ids.size + numbers.size, false);
    return {
        method: 'POST',
        path: `/open-apis/slides_ai/v1/xml_presentations/${encodeURIComponent(id)}/slide_images`,
        body: {
            ...(ids.size ? { slide_ids: [...ids] } : {}),
            ...(numbers.size ? { slide_numbers: [...numbers] } : {}),
        },
    };
}
function media(args: JsonObject): string {
    const token = String(args['file-token'] ?? '').trim();
    if (!/^[A-Za-z0-9_-]+$/u.test(token))
        fail('file-token must be a resource token.');
    output(args, 1, false);
    return `/open-apis/drive/v1/medias/${encodeURIComponent(token)}`;
}
export function slidesImageCapabilities(
    artifacts: ArtifactStore,
): Capability[] {
    return slidesImageDefinitions.map((definition) => ({
        definition,
        preview: async (args) =>
            definition.id.endsWith('screenshot')
                ? screenshot(
                      args,
                      args.content !== undefined
                          ? 'render'
                          : presentationRef(args).token,
                  )
                : {
                      path: `${media(args)}/download`,
                      fallback: {
                          path: `${media(args)}/preview_download`,
                          query: { preview_type: '16' },
                          condition: 'Permission denial only.',
                      },
                  },
        execute: async (args, context) => {
            const screen = definition.id.endsWith('screenshot');
            if (screen) screenshot(args, 'validate');
            else media(args);
            authorize(
                context.grant,
                { ...context.selection, domain: 'artifact', risk: 'write' },
                Date.now(),
            );
            if (!screen) {
                const base = media(args);
                const client = context.lark as LarkTransferClient;
                if (!client.download)
                    throw new ServiceError(
                        'TRANSFER_UNAVAILABLE',
                        'Binary download transport is required.',
                    );
                let response: Response;
                let source = 'download';
                try {
                    response = await client.download({
                        path: `${base}/download`,
                    });
                } catch (error) {
                    if (
                        !(error instanceof ServiceError) ||
                        !(
                            error.code === 'PERMISSION_DENIED' ||
                            error.details?.upstreamStatus === 403 ||
                            [1061004, 1063002, 1069902].includes(
                                Number(error.details?.upstreamCode),
                            )
                        )
                    )
                        throw error;
                    source = 'preview';
                    response = await client.download({
                        path: `${base}/preview_download`,
                        query: { preview_type: '16' },
                    });
                }
                const mime = response.headers
                    .get('content-type')
                    ?.split(';')[0]
                    ?.trim()
                    .toLowerCase();
                if (!['image/png', 'image/jpeg'].includes(mime ?? ''))
                    invalid();
                const saved = await saveDownloadResponse(
                    artifacts,
                    context,
                    response,
                    String(args.output ?? args['file-token']),
                );
                const name =
                    String(args.output ?? args['file-token']).replace(
                        /\.(png|jpe?g)$/iu,
                        '',
                    ) + (mime === 'image/png' ? '.png' : '.jpg');
                return {
                    artifactId: saved.artifact_id,
                    file_token: args['file-token'],
                    name,
                    size: saved.size_bytes,
                    content_type: mime,
                    source,
                };
            }
            if (
                typeof args.content === 'string' &&
                args.content.startsWith('@')
            ) {
                authorize(
                    context.grant,
                    { ...context.selection, domain: 'artifact', risk: 'read' },
                    Date.now(),
                );
                const response = await artifacts.read(
                    context.grant.id,
                    args.content.slice(1),
                );
                let size = 0;
                const body = response.body?.pipeThrough(
                    new TransformStream<Uint8Array, Uint8Array>({
                        transform(chunk, controller) {
                            size += chunk.byteLength;
                            if (size > 512 * 1024)
                                throw new ServiceError(
                                    'INVALID_ARGUMENTS',
                                    'Slide XML exceeds512KiB.',
                                );
                            controller.enqueue(chunk);
                        },
                    }),
                );
                args = { ...args, content: await new Response(body).text() };
            }
            const render = args.content !== undefined;
            const id = render ? '' : await resolvePresentation(args, context);
            const data = await context.lark.request(screenshot(args, id));
            const items = render ? [data.slide_image] : data.slide_images;
            if (
                !Array.isArray(items) ||
                items.length === 0 ||
                items.length > 10 ||
                (args.output && items.length !== 1)
            )
                return invalid();
            const prepared = items.map((value, index) => {
                if (!value || typeof value !== 'object' || Array.isArray(value))
                    return invalid();
                const item = value as JsonObject;
                const format = Number(item.format);
                if (
                    ![1, 2].includes(format) ||
                    typeof item.data !== 'string' ||
                    !item.data
                )
                    return invalid();
                let bytes: Uint8Array;
                try {
                    const encoded = item.data.trim();
                    const decoded = atob(encoded);
                    if (btoa(decoded) !== encoded) return invalid();
                    bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
                } catch {
                    return invalid();
                }
                const name =
                    String(
                        args.output ??
                            args['output-name'] ??
                            item.slide_id ??
                            `slide-${index + 1}`,
                    ).replace(/\.(png|jpe?g)$/iu, '') +
                    (format === 1 ? '.png' : '.jpg');
                return {
                    item,
                    blob: new Blob([bytes as BlobPart]),
                    name,
                    format: format === 1 ? 'png' : 'jpeg',
                };
            });
            const screenshots = [];
            for (const image of prepared) {
                const artifact = await artifacts.upload(
                    context.grant.id,
                    image.blob.size,
                    image.blob.stream(),
                );
                screenshots.push({
                    artifactId: artifact.id,
                    name: image.name,
                    size: artifact.size,
                    slide_id: image.item.slide_id ?? '',
                    slide_number: image.item.slide_number ?? 0,
                    format: image.format,
                });
            }
            return { ...(id ? { xml_presentation_id: id } : {}), screenshots };
        },
    }));
}

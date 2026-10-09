import { saveDownloadResponse } from '../files/index';
import { ServiceError } from '../../domain/errors';
import { authorize } from '../../domain/authorization';
import type { JsonObject } from '../../domain/models';
import type { ArtifactStore } from '../../ports/artifacts';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { ApiRequest, LarkTransferClient } from '../../ports/lark';
import { whiteboardDefinitions } from './definitions';
const invalid = (message: string): never => {
    throw new ServiceError('INVALID_ARGUMENTS', message);
};
const upstream = (): never => {
    throw new ServiceError(
        'INVALID_UPSTREAM_RESPONSE',
        'Whiteboard returned an invalid result.',
        502,
    );
};
const object = (v: unknown): JsonObject =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
        ? (v as JsonObject)
        : {};
function token(args: JsonObject): string {
    const v = String(args['whiteboard-token'] ?? '');
    if (!v || /[\x00-\x1f\x7f]/u.test(v))
        invalid('A safe whiteboard-token is required.');
    return encodeURIComponent(v);
}
function update(args: JsonObject): ApiRequest {
    const path = `/open-apis/board/v1/whiteboards/${token(args)}/nodes`;
    const source = String(args.source ?? '');
    if (!source) invalid('source is required.');
    const id = String(args['idempotent-token'] ?? '');
    if (id && (id.length < 10 || /[\x00-\x1f\x7f]/u.test(id)))
        invalid('idempotent-token must contain at least ten safe characters.');
    const format = String(args.input_format ?? 'raw');
    const query = id ? { client_token: id } : {};
    const overwrite = args.overwrite === true ? { overwrite: true } : {};
    if (format === 'raw') {
        let parsed: JsonObject;
        try {
            parsed = object(JSON.parse(source));
        } catch {
            return invalid('source must be a valid JSON node envelope.');
        }
        let nodes = parsed.nodes;
        if (!Array.isArray(nodes)) {
            const data = object(parsed.data);
            if ((parsed.code ?? 0) !== 0 || data.to !== 'openapi')
                invalid(
                    'source must contain nodes or a successful openapi conversion.',
                );
            nodes = object(data.result).nodes;
        }
        if (!Array.isArray(nodes)) invalid('source nodes must be an array.');
        return { method: 'POST', path, query, body: { nodes, ...overwrite } };
    }
    const code = (
        { plantuml: 1, mermaid: 2, svg: 3 } as Record<string, number>
    )[format];
    if (!code) invalid('Unsupported input_format.');
    return {
        method: 'POST',
        path: `${path}/plantuml`,
        query,
        body: {
            plant_uml_code: source,
            syntax_type: code,
            parse_mode: 1,
            ...overwrite,
        },
    };
}
function outputType(args: JsonObject, legacy: boolean): string {
    const raw = String(args[legacy ? 'output_as' : 'output-type'] ?? '');
    const type = legacy
        ? (({ image: 'preview', code: 'source' } as Record<string, string>)[
              raw
          ] ?? raw)
        : raw;
    if (!['preview', 'svg', 'source', 'raw'].includes(type))
        invalid('Unsupported output type.');
    if (type === 'preview' && !args.output)
        invalid('An output artifact name is required for a preview.');
    return type;
}
function exportRequest(args: JsonObject, type: string): ApiRequest {
    const path = `/open-apis/board/v1/whiteboards/${token(args)}`;
    return type === 'svg'
        ? {
              method: 'POST',
              path: `${path}/export`,
              body: { export_type: 'svg' },
          }
        : {
              method: 'GET',
              path: `${path}/${type === 'preview' ? 'download_as_image' : 'nodes'}`,
          };
}
async function save(
    store: ArtifactStore,
    context: CommandContext,
    body: ReadableStream<Uint8Array>,
    size: number,
    name: string,
): Promise<unknown> {
    authorize(
        context.grant,
        { ...context.selection, domain: 'artifact', risk: 'write' },
        Date.now(),
    );
    const result = await store.upload(context.grant.id, size, body);
    return {
        artifactId: result.id,
        name,
        size_bytes: result.size,
        expiresAt: result.expiresAt,
    };
}
export function whiteboardCapabilities(store: ArtifactStore): Capability[] {
    return whiteboardDefinitions.map((definition) => ({
        definition,
        preview: async (args) =>
            definition.risk === 'write'
                ? typeof args.source === 'string' && args.source.startsWith('@')
                    ? {
                          artifact: args.source.slice(1),
                          operation: 'whiteboard-update',
                          hydration: 'deferred',
                      }
                    : update(args)
                : exportRequest(
                      args,
                      outputType(args, definition.id.endsWith('query')),
                  ),
        execute: async (args, context) => {
            if (definition.risk === 'write') {
                if (
                    typeof args.source === 'string' &&
                    args.source.startsWith('@')
                ) {
                    authorize(
                        context.grant,
                        {
                            ...context.selection,
                            domain: 'artifact',
                            risk: 'read',
                        },
                        Date.now(),
                    );
                    const response = await store.read(
                        context.grant.id,
                        args.source.slice(1),
                    );
                    let size = 0;
                    const body = response.body?.pipeThrough(
                        new TransformStream<Uint8Array, Uint8Array>({
                            transform(chunk, controller) {
                                size += chunk.byteLength;
                                if (size > 20_000_000)
                                    throw new ServiceError(
                                        'INVALID_ARGUMENTS',
                                        'Whiteboard source exceeds 20,000,000 bytes.',
                                    );
                                controller.enqueue(chunk);
                            },
                        }),
                    );
                    args = { ...args, source: await new Response(body).text() };
                }
                const request = update(args);
                const data = await context.lark.request(request);
                if (request.path.endsWith('/plantuml')) {
                    if (typeof data.node_id !== 'string' || !data.node_id)
                        upstream();
                    return { created_node_id: data.node_id };
                }
                if (
                    !Array.isArray(data.ids) ||
                    !data.ids.every((x) => typeof x === 'string')
                )
                    upstream();
                return { created_node_ids: (data.ids as string[]).join(',') };
            }
            const type = outputType(args, definition.id.endsWith('query'));
            const request = exportRequest(args, type);
            if (args.output)
                authorize(
                    context.grant,
                    { ...context.selection, domain: 'artifact', risk: 'write' },
                    Date.now(),
                );
            if (type === 'preview') {
                const client = context.lark as LarkTransferClient;
                if (!client.download)
                    throw new ServiceError(
                        'TRANSFER_UNAVAILABLE',
                        'Binary download transport is required.',
                    );
                const response = await client.download({ path: request.path });
                const mime = response.headers
                    .get('content-type')
                    ?.split(';')[0]
                    ?.trim()
                    .toLowerCase();
                if (!['image/png', 'image/jpeg'].includes(mime ?? ''))
                    upstream();
                const name = String(args.output);
                const extension = name
                    .match(/\.([^.\/]+)$/u)?.[1]
                    ?.toLowerCase();
                if (
                    extension &&
                    !(
                        mime === 'image/png' ? ['png'] : ['jpg', 'jpeg']
                    ).includes(extension)
                )
                    invalid(
                        'Output extension must match the preview media type.',
                    );
                const saved = await saveDownloadResponse(
                    store,
                    context,
                    response,
                    name,
                );
                return {
                    artifactId: saved.artifact_id,
                    name: saved.filename,
                    size_bytes: saved.size_bytes,
                    download_path: saved.download_path,
                };
            }
            const data = await context.lark.request(request);
            let output: JsonObject;
            let content: string;
            if (type === 'svg') {
                if (typeof data.content !== 'string') upstream();
                try {
                    content = new TextDecoder().decode(
                        Uint8Array.from(atob(data.content as string), (c) =>
                            c.charCodeAt(0),
                        ),
                    );
                } catch {
                    return upstream();
                }
                output = { svg_content: content };
            } else {
                if (data.nodes === undefined || data.nodes === null)
                    return { msg: 'whiteboard is empty' };
                if (!Array.isArray(data.nodes)) upstream();
                if (type === 'raw') {
                    output = { nodes: data.nodes };
                    content = JSON.stringify(output, null, 2);
                } else {
                    const blocks = (data.nodes as unknown[])
                        .map((n) => object(object(n).syntax))
                        .filter(
                            (n) =>
                                typeof n.code === 'string' &&
                                n.code &&
                                [1, 2].includes(Number(n.syntax_type)),
                        );
                    if (blocks.length !== 1)
                        return {
                            msg: blocks.length
                                ? 'multiple code blocks found, cannot export directly'
                                : 'no code blocks found in whiteboard',
                        };
                    content = String(blocks[0]!.code);
                    output = {
                        code: content,
                        syntax_type:
                            blocks[0]!.syntax_type === 1
                                ? 'plantuml'
                                : 'mermaid',
                    };
                }
            }
            if (!args.output) return output;
            const blob = new Blob([content]);
            return save(
                store,
                context,
                blob.stream(),
                blob.size,
                String(args.output),
            );
        },
    }));
}

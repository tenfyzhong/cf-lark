import { ServiceError } from '../../domain/errors';
import { authorize } from '../../domain/authorization';
import type { JsonObject } from '../../domain/models';
import type { ArtifactStore } from '../../ports/artifacts';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { slidesDefinitions, presentationAliases } from './definitions';
const fail = (message: string): never => {
    throw new ServiceError('INVALID_ARGUMENTS', message);
};
const bad = (): never => {
    throw new ServiceError(
        'INVALID_UPSTREAM_RESPONSE',
        'Slides returned an incomplete result.',
        502,
    );
};
const obj = (value: unknown): JsonObject =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as JsonObject)
        : {};
export function presentationRef(args: JsonObject): {
    kind: 'slides' | 'wiki';
    token: string;
} {
    const values = presentationAliases
        .filter((k) => args[k] !== undefined)
        .map((k) => String(args[k]).trim());
    if (!values.length || values.some((v) => !v) || new Set(values).size !== 1)
        return fail('Provide one unambiguous presentation locator.');
    const value = values[0]!;
    if (/[\x00-\x1f\x7f]/u.test(value))
        fail('Presentation contains control characters.');
    if (value.includes('://')) {
        let url: URL;
        try {
            url = new URL(value);
        } catch {
            return fail('Invalid presentation URL.');
        }
        const match = /^\/(slides|wiki)\/([^/]+)/u.exec(
            decodeURIComponent(url.pathname),
        );
        if (!match)
            return fail('Presentation URL must have a Slides or Wiki path.');
        return { kind: match[1] as 'slides' | 'wiki', token: match[2]! };
    }
    if (/[/?#]/u.test(value))
        fail('Use a bare token or a complete Slides or Wiki URL.');
    return { kind: 'slides', token: value };
}
export async function resolvePresentation(
    args: JsonObject,
    context: CommandContext,
): Promise<string> {
    const ref = presentationRef(args);
    if (ref.kind === 'slides') return ref.token;
    const data = await context.lark.request({
        method: 'GET',
        path: '/open-apis/wiki/v2/spaces/node_by_token',
        query: { token: ref.token },
    });
    const node = obj(data.node);
    if (!node.obj_type || typeof node.obj_token !== 'string' || !node.obj_token)
        return bad();
    if (node.obj_type !== 'slides')
        fail('Wiki node does not identify a Slides presentation.');
    return String(node.obj_token);
}
function required(args: JsonObject, key: string): string {
    const value = String(args[key] ?? '').trim();
    if (!value) fail(`${key} is required.`);
    return value;
}
function request(name: string, args: JsonObject, id: string): ApiRequest {
    const path = `/open-apis/slides_ai/v1/xml_presentations/${encodeURIComponent(id)}`;
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
    if (name === 'history-revert') {
        const version = required(args, 'history-version-id');
        if (
            !/^\+?\d+$/u.test(version) ||
            BigInt(version) < 1n ||
            BigInt(version) > 9223372036854775807n
        )
            fail('history-version-id must be a positive int64 string.');
        return {
            method: 'POST',
            path: `${path}/history/revert`,
            body: { history_version_id: version },
        };
    }
    if (name === 'history-revert-status')
        return {
            method: 'GET',
            path: `${path}/history/revert_status`,
            query: { task_id: required(args, 'task-id') },
        };
    const revision = args['revision-id'] ?? -1;
    if (!Number.isSafeInteger(revision) || Number(revision) < -1)
        fail('revision-id must be -1 or a nonnegative safe integer.');
    if (name === 'delete-slide')
        return {
            method: 'DELETE',
            path: `${path}/slide`,
            query: {
                slide_id: required(args, 'slide-id'),
                revision_id: revision,
            },
        };
    const slide =
        args['slide-id'] === undefined ? '' : required(args, 'slide-id');
    const number = args['slide-number'];
    if (
        number !== undefined &&
        (!Number.isSafeInteger(number) || Number(number) < 1)
    )
        fail('slide-number must be positive.');
    if (slide && number !== undefined)
        fail('Slide selectors are mutually exclusive.');
    if ((slide || number !== undefined) && args['remove-attr-id'])
        fail('remove-attr-id requires a full presentation read.');
    if (args.raw && args.output) fail('raw and output are mutually exclusive.');
    return {
        method: 'GET',
        path: `${path}${slide || number !== undefined ? '/slide' : ''}`,
        query: {
            revision_id: revision,
            ...(slide ? { slide_id: slide } : {}),
            ...(number !== undefined ? { slide_number: number } : {}),
            ...(args['remove-attr-id'] ? { remove_attr_id: true } : {}),
        },
    };
}
export function slidesCapabilities(artifacts: ArtifactStore): Capability[] {
    return slidesDefinitions.map((definition) => {
        const name = definition.id.slice('slides.+'.length);
        return {
            definition,
            preview: async (args) => {
                const ref = presentationRef(args);
                return {
                    request: request(
                        name,
                        args,
                        ref.kind === 'wiki'
                            ? '{resolved_slides_token}'
                            : ref.token,
                    ),
                    ...(ref.kind === 'wiki'
                        ? {
                              resolve: {
                                  method: 'GET',
                                  path: '/open-apis/wiki/v2/spaces/node_by_token',
                                  query: { token: ref.token },
                              },
                          }
                        : {}),
                };
            },
            execute: async (args, context) => {
                presentationRef(args);
                request(name, args, 'validate');
                if (args.output)
                    authorize(
                        context.grant,
                        {
                            ...context.selection,
                            domain: 'artifact',
                            risk: 'write',
                        },
                        Date.now(),
                    );
                const id = await resolvePresentation(args, context);
                const data = await context.lark.request(
                    request(name, args, id),
                );
                if (name.startsWith('history-')) return data;
                if (name === 'delete-slide')
                    return {
                        xml_presentation_id: id,
                        slide_id: required(args, 'slide-id'),
                        deleted: true,
                        ...(data.revision_id !== undefined
                            ? { revision_id: data.revision_id }
                            : {}),
                    };
                const single =
                    args['slide-id'] !== undefined ||
                    args['slide-number'] !== undefined;
                const value = obj(data[single ? 'slide' : 'xml_presentation']);
                const content = value.content;
                if (typeof content !== 'string' || !content) return bad();
                const nested: JsonObject = { content };
                const output: JsonObject = {
                    xml_presentation_id: id,
                    scope: single ? 'slide' : 'presentation',
                    [single ? 'slide' : 'xml_presentation']: nested,
                };
                if (single) {
                    const slideId =
                        value.slide_id || String(args['slide-id'] ?? '').trim();
                    if (slideId) {
                        nested.slide_id = slideId;
                        output.slide_id = slideId;
                    }
                    if (args['slide-number']) {
                        nested.slide_number = args['slide-number'];
                        output.slide_number = args['slide-number'];
                    }
                }
                const revision = single ? data.revision_id : value.revision_id;
                if (Number(revision) > 0) {
                    nested.revision_id = revision;
                    output.revision_id = revision;
                }
                if (args['remove-attr-id']) output.remove_attr_id = true;
                if (args.raw) return content;
                if (!args.output) return output;
                const blob = new Blob([content]);
                const artifact = await artifacts.upload(
                    context.grant.id,
                    blob.size,
                    blob.stream(),
                );
                delete output[single ? 'slide' : 'xml_presentation'];
                return {
                    ...output,
                    artifactId: artifact.id,
                    name: args.output,
                    size: artifact.size,
                    content_saved: true,
                };
            },
        };
    });
}

import { prepareSlideMutation } from './mutations';
import { decodeXML } from 'entities';
import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { mediaUploadProgram } from '../files/index';
import { presentationRef, resolvePresentation } from './commands';
import { validateXML, xmlTokens } from './xml';
import { slidesWorkflowDefinitions } from './workflow-definitions';
const fail = (message: string): never => {
    throw new ServiceError('INVALID_ARGUMENTS', message);
};
const obj = (value: unknown): JsonObject =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as JsonObject)
        : {};
const escape = (s: string) =>
    s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('"', '&quot;');
function listJSON(value: unknown): unknown[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(String(value));
    } catch {
        return fail('Expected a JSON array.');
    }
    if (!Array.isArray(parsed)) fail('Expected a JSON array.');
    return parsed as unknown[];
}
function pages(command: string, args: JsonObject): JsonObject[] {
    if (
        ['add-slide', 'update-slide', 'update', 'replace-slide'].includes(
            command,
        )
    ) {
        const request = prepareSlideMutation(command, args, 'validate').request;
        const content: JsonObject[] = [];
        const walk = (v: unknown): void => {
            if (typeof v === 'string' && v.trim().startsWith('<'))
                content.push({ content: v });
            else if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === 'object') Object.values(v).forEach(walk);
        };
        walk(request.body);
        return content;
    }
    if (command === 'media-upload') {
        if (!String(args.file ?? '').trim())
            fail('file must be an artifact ID.');
        return [];
    }
    if (command === 'create') {
        if (args.slides !== undefined && args.slide !== undefined)
            fail('slides and slide are mutually exclusive.');
        const values =
            args.slides !== undefined
                ? listJSON(args.slides)
                : (args.slide ?? []);
        if (!Array.isArray(values) || values.length > 10)
            fail('Create accepts at most ten slides.');
        return (values as unknown[]).map((v) => {
            if (typeof v !== 'string') fail('Each slide must be XML text.');
            validateXML(String(v), 'slide', false);
            return { content: v };
        });
    }
    const values = listJSON(args.pages);
    if (!values.length) fail('pages must not be empty.');
    const seen = new Set<string>();
    return (values as unknown[]).map((v) => {
        const item = obj(v);
        const id = String(item.slide_id ?? '').trim();
        if (!id || seen.has(id) || item.slide_number !== undefined)
            fail('Each replacement requires a unique slide_id.');
        seen.add(id);
        if (typeof item.content !== 'string')
            fail('Each page needs XML content.');
        validateXML(String(item.content), 'slide', false);
        return { slide_id: id, content: item.content };
    });
}
function placeholders(pages: JsonObject[]): string[] {
    const found = new Set<string>();
    for (const page of pages)
        for (const t of xmlTokens(String(page.content))) {
            if (t.name !== 'img' || t.close) continue;
            const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/u.exec(t.text);
            const value = decodeXML(src?.[1] ?? src?.[2] ?? '');
            if (value.startsWith('@')) {
                if (value.length === 1)
                    fail('Image placeholders require an artifact ID.');
                found.add(value.slice(1));
            }
        }
    return [...found];
}
function replaceImages(content: string, tokens: JsonObject): string {
    const spans = xmlTokens(content).filter(
        (t) => t.name === 'img' && !t.close,
    );
    for (const t of spans.reverse()) {
        const text = t.text.replace(
            /(\ssrc\s*=\s*)(?:"([^"]*)"|'([^']*)')/u,
            (all, prefix: string, a: string, b: string) => {
                const src = decodeXML(a ?? b ?? '');
                const replacement = tokens[src.slice(1)];
                return src.startsWith('@') && typeof replacement === 'string'
                    ? `${prefix}"${escape(replacement)}"`
                    : all;
            },
        );
        content =
            content.slice(0, t.offset) +
            text +
            content.slice(t.offset + t.text.length);
    }
    return content;
}
function recipient(context: CommandContext): string | undefined {
    const accounts =
        context.grant.profiles.find(
            (p) => p.profileId === context.selection.profileId,
        )?.accounts ?? [];
    if (context.selection.accountId) {
        if (!accounts.includes(context.selection.accountId))
            throw new ServiceError(
                'FORBIDDEN',
                'Permission recipient is outside this grant.',
                403,
            );
        return context.selection.accountId;
    }
    return accounts.length === 1 ? accounts[0] : undefined;
}
export function slidesPrograms(files: ArtifactFiles): WorkflowProgram[] {
    const upload = mediaUploadProgram(files);
    return [
        {
            id: 'slides-authoring',
            version: 1,
            domain: 'slides',
            risk: 'write',
            identities: ['user', 'bot'],
            async step(state, context) {
                const args = obj(state.args);
                const command = String(state.command);
                const next = (patch: JsonObject) => ({
                    done: false as const,
                    state: { ...state, ...patch },
                });
                const id = String(state.presentationId ?? '');
                const plan = state.pages as JsonObject[] | undefined;
                const index = Number(state.index ?? 0);
                const results = (state.results ?? []) as JsonObject[];
                if (state.phase === 'start') {
                    const loaded = { ...args };
                    for (const key of [
                        'content',
                        'xml',
                        'slide-xml',
                        'slide-content',
                        'content-xml',
                        'slides',
                        'parts',
                        'pages',
                        'slide',
                    ]) {
                        const value = loaded[key];
                        const values = Array.isArray(value) ? value : [value];
                        for (let i = 0; i < values.length; i++) {
                            const item = values[i];
                            if (
                                typeof item !== 'string' ||
                                !item.startsWith('@')
                            )
                                continue;
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
                                item.slice(1),
                            );
                            if (artifact.size > 512 * 1024)
                                fail('XML input artifact exceeds 512 KiB.');
                            const text = await (
                                await files.read(
                                    context.grant.id,
                                    item.slice(1),
                                )
                            ).text();
                            if (Array.isArray(value)) {
                                const copy = [...value];
                                copy[i] = text;
                                loaded[key] = copy;
                            } else loaded[key] = text;
                            return next({ args: loaded });
                        }
                    }
                    const prepared = pages(command, args);
                    if (command !== 'create') presentationRef(args);
                    const images =
                        command === 'media-upload'
                            ? [String(args.file)]
                            : placeholders(prepared);
                    if (images.length)
                        authorize(
                            context.grant,
                            {
                                ...context.selection,
                                domain: 'artifact',
                                risk: 'read',
                            },
                            Date.now(),
                        );
                    return next({
                        phase: 'validate',
                        pages: prepared,
                        images,
                        validated: 0,
                        index: 0,
                        results: [],
                        tokens: {},
                        revision: -1,
                    });
                }
                if (state.phase === 'validate') {
                    const images = state.images as string[];
                    const n = Number(state.validated);
                    if (n < images.length) {
                        const file = await files.stat(
                            context.grant.id,
                            images[n]!,
                        );
                        if (file.size > 20 * 1024 * 1024)
                            fail('Slides images must not exceed 20 MiB.');
                        return next({ validated: n + 1 });
                    }
                    if (command === 'create') return next({ phase: 'create' });
                    return next({
                        presentationId: await resolvePresentation(
                            args,
                            context,
                        ),
                        phase: args['validate-only'] ? 'complete' : 'upload',
                    });
                }
                if (state.phase === 'create') {
                    const title = String(args.title ?? '').trim() || 'Untitled';
                    const data = await context.lark.request({
                        method: 'POST',
                        path: '/open-apis/slides_ai/v1/xml_presentations',
                        body: {
                            xml_presentation: {
                                content: `<presentation xmlns="https://www.larkoffice.com/sml/2.0" width="960" height="540"><title>${escape(title)}</title></presentation>`,
                            },
                        },
                    });
                    if (
                        typeof data.xml_presentation_id !== 'string' ||
                        !data.xml_presentation_id
                    )
                        throw new ServiceError(
                            'INVALID_UPSTREAM_RESPONSE',
                            'Created presentation returned no ID. Do not repeat creation.',
                            502,
                        );
                    return next({
                        presentationId: data.xml_presentation_id,
                        phase: 'upload',
                        title,
                        revision: data.revision_id ?? -1,
                    });
                }
                if (state.phase === 'upload') {
                    const images = state.images as string[];
                    const n = Number(state.imageIndex ?? 0);
                    if (n >= images.length)
                        return next({
                            phase:
                                command === 'media-upload'
                                    ? 'complete'
                                    : [
                                            'add-slide',
                                            'update-slide',
                                            'update',
                                            'replace-slide',
                                        ].includes(command)
                                      ? 'mutate'
                                      : 'write',
                            index: 0,
                        });
                    const file = images[n]!;
                    const office =
                        id.startsWith('fake_office_') ||
                        id.startsWith('local_office_') ||
                        (id.length >= 25 &&
                            [4, 9, 14, 19, 24].map((o) => id[o]).join('') ===
                                'OFL0X');
                    const input = state.uploadState
                        ? obj(state.uploadState)
                        : {
                              phase: 'start',
                              args: {
                                  file,
                                  'parent-type': office
                                      ? 'office_slide_file'
                                      : 'slide_file',
                                  'parent-node': id,
                              },
                          };
                    const result = await upload.step(input, context);
                    if (!result.done)
                        return next({ uploadState: result.state });
                    return next({
                        uploadState: null,
                        imageIndex: n + 1,
                        tokens: {
                            ...obj(state.tokens),
                            [file]: obj(result.output).file_token,
                        },
                    });
                }
                if (state.phase === 'mutate') {
                    const prepared = prepareSlideMutation(command, args, id);
                    const rewrite = (v: unknown): unknown =>
                        typeof v === 'string' && v.trim().startsWith('<')
                            ? replaceImages(v, obj(state.tokens))
                            : Array.isArray(v)
                              ? v.map(rewrite)
                              : v && typeof v === 'object'
                                ? Object.fromEntries(
                                      Object.entries(v).map(([k, x]) => [
                                          k,
                                          rewrite(x),
                                      ]),
                                  )
                                : v;
                    prepared.request.body = rewrite(prepared.request.body);
                    const result = await context.lark.request(prepared.request);
                    return next({
                        mutationResult: {
                            xml_presentation_id: id,
                            ...(args['slide-id']
                                ? { slide_id: args['slide-id'] }
                                : {}),
                            ...result,
                        },
                        phase: 'complete',
                    });
                }
                if (state.phase === 'write') {
                    if (index >= (plan?.length ?? 0))
                        return next({
                            phase:
                                command === 'create'
                                    ? 'permission'
                                    : 'complete',
                        });
                    const page = plan![index]!;
                    const body: JsonObject = {
                        slide: {
                            content: replaceImages(
                                String(page.content),
                                obj(state.tokens),
                            ),
                        },
                        lint_xml: args['no-lint'] !== true,
                    };
                    if (command === 'replace-pages')
                        body.before_slide_id = page.slide_id;
                    try {
                        const data = await context.lark.request({
                            method: 'POST',
                            path: `/open-apis/slides_ai/v1/xml_presentations/${encodeURIComponent(id)}/slide`,
                            query: {
                                revision_id:
                                    command === 'create'
                                        ? -1
                                        : (state.revision ?? -1),
                            },
                            body,
                        });
                        if (typeof data.slide_id !== 'string' || !data.slide_id)
                            throw new ServiceError(
                                'OUTCOME_UNCERTAIN',
                                'Slide creation returned no ID. Do not repeat this write.',
                                502,
                            );
                        const entry = {
                            ...(command === 'replace-pages'
                                ? {
                                      old_slide_id: page.slide_id,
                                      new_slide_id: data.slide_id,
                                  }
                                : { slide_id: data.slide_id }),
                            status:
                                command === 'replace-pages'
                                    ? 'created'
                                    : 'added',
                            ...(data.issues ? { issues: data.issues } : {}),
                            ...(data.revision_id !== undefined
                                ? { revision_id: data.revision_id }
                                : {}),
                        };
                        return next({
                            results: [...results, entry],
                            revision: data.revision_id ?? state.revision,
                            index: command === 'create' ? index + 1 : index,
                            phase: command === 'create' ? 'write' : 'delete',
                        });
                    } catch (error) {
                        if (
                            !(error instanceof ServiceError) ||
                            error.code === 'OUTCOME_UNCERTAIN'
                        )
                            throw error;
                        const entry = {
                            old_slide_id: page.slide_id,
                            status: 'create_failed',
                            error: error.message,
                            error_code: error.code,
                        };
                        return next({
                            results: [...results, entry],
                            index: index + 1,
                            phase:
                                command === 'replace-pages' &&
                                args['continue-on-error']
                                    ? 'write'
                                    : 'complete',
                            partialFailure: true,
                        });
                    }
                }
                if (state.phase === 'delete') {
                    const page = plan![index]!;
                    try {
                        const data = await context.lark.request({
                            method: 'DELETE',
                            path: `/open-apis/slides_ai/v1/xml_presentations/${encodeURIComponent(id)}/slide`,
                            query: {
                                slide_id: page.slide_id,
                                revision_id: state.revision ?? -1,
                            },
                        });
                        return next({
                            results: results.map((r, i) =>
                                i === results.length - 1
                                    ? {
                                          ...r,
                                          status: 'replaced',
                                          ...(data.revision_id !== undefined
                                              ? {
                                                    revision_id:
                                                        data.revision_id,
                                                }
                                              : {}),
                                      }
                                    : r,
                            ),
                            revision: data.revision_id ?? state.revision,
                            index: index + 1,
                            phase: 'write',
                        });
                    } catch (error) {
                        if (
                            !(error instanceof ServiceError) ||
                            error.code === 'OUTCOME_UNCERTAIN'
                        )
                            throw error;
                        return next({
                            results: results.map((r, i) =>
                                i === results.length - 1
                                    ? {
                                          ...r,
                                          status: 'delete_failed',
                                          error: error.message,
                                          error_code: error.code,
                                      }
                                    : r,
                            ),
                            index: index + 1,
                            phase: args['continue-on-error']
                                ? 'write'
                                : 'complete',
                            partialFailure: true,
                        });
                    }
                }
                if (state.phase === 'permission') {
                    let permission: JsonObject | undefined;
                    if (context.selection.identity === 'bot') {
                        const user = recipient(context);
                        permission = { status: 'skipped', perm: 'full_access' };
                        if (user) {
                            try {
                                await context.lark.request({
                                    method: 'POST',
                                    path: `/open-apis/drive/v1/permissions/${encodeURIComponent(id)}/members`,
                                    query: {
                                        type: 'slides',
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
                                    perm: 'full_access',
                                    member_id: user,
                                };
                            } catch {
                                permission = {
                                    status: 'failed',
                                    perm: 'full_access',
                                    member_id: user,
                                };
                            }
                        }
                    }
                    return next({ permission, phase: 'complete' });
                }
                if (state.phase === 'complete') {
                    if (state.mutationResult)
                        return { done: true, output: state.mutationResult };
                    if (args['validate-only'])
                        return {
                            done: true,
                            output: {
                                xml_presentation_id: id,
                                validated: true,
                                plan,
                            },
                        };
                    if (command === 'media-upload')
                        return {
                            done: true,
                            output: {
                                file_token: obj(state.tokens)[
                                    String(args.file)
                                ],
                                xml_presentation_id: id,
                            },
                        };
                    return {
                        done: true,
                        output: {
                            xml_presentation_id: id,
                            results,
                            ...(state.revision !== -1
                                ? { revision_id: state.revision }
                                : {}),
                            ...(command === 'create'
                                ? {
                                      title: state.title,
                                      url: `${context.lark.brand === 'lark' ? 'https://www.larksuite.com' : 'https://www.feishu.cn'}/slides/${id}`,
                                      slides_added: results.filter(
                                          (r) => r.status === 'added',
                                      ).length,
                                      images_uploaded: Object.keys(
                                          obj(state.tokens),
                                      ).length,
                                      ...(state.permission
                                          ? {
                                                permission_grant:
                                                    state.permission,
                                            }
                                          : {}),
                                  }
                                : {}),
                            ...(state.partialFailure
                                ? { status: 'partial_failure' }
                                : {}),
                        },
                    };
                }
                throw new ServiceError(
                    'INVALID_WORKFLOW_STATE',
                    'Unknown Slides authoring phase.',
                    500,
                );
            },
        },
    ];
}
export function slidesWorkflowCapabilities(
    _files: ArtifactFiles,
    workflows: WorkflowRunner,
): Capability[] {
    return slidesWorkflowDefinitions.map((definition) => {
        const command = definition.id.slice(8);
        return {
            definition,
            preview: async (args) => {
                const plan = Object.values(args).some(
                    (v) =>
                        (typeof v === 'string' && v.startsWith('@')) ||
                        (Array.isArray(v) &&
                            v.some(
                                (x) =>
                                    typeof x === 'string' && x.startsWith('@'),
                            )),
                )
                    ? []
                    : pages(command, args);
                if (command !== 'create') presentationRef(args);
                return {
                    workflow: 'slides-authoring',
                    command,
                    plan,
                    images: placeholders(plan),
                    atomic: false,
                };
            },
            execute: async (args, context) => {
                if (
                    !Object.values(args).some(
                        (v) =>
                            (typeof v === 'string' && v.startsWith('@')) ||
                            (Array.isArray(v) &&
                                v.some(
                                    (x) =>
                                        typeof x === 'string' &&
                                        x.startsWith('@'),
                                )),
                    )
                )
                    pages(command, args);
                if (command !== 'create') presentationRef(args);
                return workflows.start(
                    'slides-authoring',
                    { phase: 'start', command, args },
                    context.selection,
                    context.grant,
                );
            },
        };
    });
}

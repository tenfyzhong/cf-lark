import { ServiceError } from '../../domain/errors';
import { authorize } from '../../domain/authorization';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { DocumentParser } from '../../ports/document-parser';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { RemoteFiles } from '../../ports/remote-files';
import { documentRef } from './commands';
import { prepareDocumentResources } from './resources';
import { docsScriptDefinition } from './script-definition';
const fail = (message: string): never => {
    throw new ServiceError('INVALID_ARGUMENTS', message);
};
const object = (v: unknown): JsonObject =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
        ? (v as JsonObject)
        : fail('Expected a JSON object.');
const fields = (v: JsonObject, allowed: string[]) => {
    if (Object.keys(v).some((k) => !allowed.includes(k)))
        fail('Unknown Presentation Decision field.');
};
const presentation = new Set(
    'grid table pre img bitable sheet mindnote whiteboard html5-block figure callout chat_card okr poll agenda folder-manager sub-page-list wiki_catalog wiki_recent_update chart-embedded chart-refer-host-perm chart_embedded chart_refer_host_perm bookmark vc-tabs vc-summary-tab vc-transcribe-tab list'.split(
        ' ',
    ),
);
function decision(text: string): JsonObject {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        fail('Presentation Decision must be valid JSON.');
    }
    const d = object(value);
    fields(d, [
        'audience',
        'reader_task',
        'genre_contract',
        'adapter',
        'presentation_mode',
        'word_count',
        'visual_plan',
    ]);
    for (const key of [
        'audience',
        'reader_task',
        'genre_contract',
        'adapter',
        'presentation_mode',
    ])
        if (d[key] != null && typeof d[key] !== 'string')
            fail(`${key} must be text or null.`);
    if ('word_count' in d) {
        const w = object(d.word_count);
        fields(w, ['min', 'max']);
        if (
            !('min' in w) ||
            !('max' in w) ||
            (w.min === null && w.max === null)
        )
            fail(
                'word_count requires min and max, with at least one non-null bound.',
            );
        for (const key of ['min', 'max'])
            if (
                w[key] !== null &&
                (!Number.isSafeInteger(w[key]) || Number(w[key]) <= 0)
            )
                fail('Word bounds must be positive integers or null.');
        if (w.min !== null && w.max !== null && Number(w.min) > Number(w.max))
            fail('Word minimum exceeds maximum.');
    }
    if (d.visual_plan != null) {
        const v = object(d.visual_plan);
        fields(v, ['reason', 'blocks']);
        if (v.reason != null && typeof v.reason !== 'string')
            fail('Visual reason must be text.');
        if (v.blocks != null) {
            if (!Array.isArray(v.blocks))
                fail('Visual blocks must be an array.');
            const seen = new Set<string>();
            for (const item of v.blocks as unknown[]) {
                const b = object(item);
                fields(b, ['type', 'min_count', 'purpose']);
                if (
                    b.type != null &&
                    (typeof b.type !== 'string' || !presentation.has(b.type))
                )
                    fail('Unsupported presentation block type.');
                if (b.purpose != null && typeof b.purpose !== 'string')
                    fail('Block purpose must be text.');
                if (
                    b.min_count != null &&
                    (!Number.isSafeInteger(b.min_count) ||
                        Number(b.min_count) <= 0)
                )
                    fail('Block minimum must be positive.');
                if (b.type != null && b.min_count != null) {
                    if (seen.has(String(b.type)))
                        fail('Duplicate presentation block constraint.');
                    seen.add(String(b.type));
                }
            }
        }
    }
    return d;
}
function validate(args: JsonObject) {
    if (!['init-draft', 'parse'].includes(String(args.command)))
        fail('command must be init-draft or parse.');
    if (args.command === 'init-draft') {
        if (args.content !== undefined || args.doc !== undefined)
            fail('init-draft does not accept content or doc.');
        if (typeof args['presentation-decision'] !== 'string')
            fail('init-draft requires presentation-decision.');
    } else if (
        (typeof args.content === 'string') ===
        (typeof args.doc === 'string')
    )
        fail('parse requires exactly one of content or doc.');
    if (args.workspace && args['presentation-decision'])
        fail('workspace and presentation-decision are mutually exclusive.');
    if (
        typeof args['presentation-decision'] === 'string' &&
        !args['presentation-decision'].startsWith('@')
    )
        decision(args['presentation-decision']);
}
export function docsScriptCapability(
    files: ArtifactFiles,
    parser: DocumentParser,
    _remote?: RemoteFiles,
): Capability {
    return {
        definition: docsScriptDefinition,
        preview: async (args) => {
            validate(args);
            return {
                command: args.command,
                source: args.doc
                    ? 'online'
                    : args.content
                      ? 'inline-or-artifact'
                      : 'workspace',
                writes_lark: false,
            };
        },
        execute: async (args, context) => {
            validate(args);
            const read = async (id: string) => {
                authorize(
                    context.grant,
                    { ...context.selection, domain: 'artifact', risk: 'read' },
                    Date.now(),
                );
                const a = await files.stat(context.grant.id, id);
                if (a.size > 20_000_000)
                    fail('Document input exceeds 20,000,000 bytes.');
                return (await files.read(context.grant.id, id)).text();
            };
            const dtext = args.workspace
                ? await read(String(args.workspace))
                : typeof args['presentation-decision'] === 'string'
                  ? args['presentation-decision'].startsWith('@')
                      ? await read(args['presentation-decision'].slice(1))
                      : args['presentation-decision']
                  : undefined;
            const d = dtext === undefined ? undefined : decision(dtext);
            if (args.command === 'init-draft') {
                authorize(
                    context.grant,
                    { ...context.selection, domain: 'artifact', risk: 'write' },
                    Date.now(),
                );
                const blob = new Blob([JSON.stringify(d)]);
                const artifact = await files.upload(
                    context.grant.id,
                    blob.size,
                    blob.stream(),
                );
                return {
                    workspace: artifact.id,
                    draft_created: false,
                    presentation_decision: d,
                };
            }
            let xml = String(args.content ?? '');
            if (args.doc) {
                const ref = documentRef(args.doc);
                const result = await context.lark.request({
                    method: 'POST',
                    path: `/open-apis/docs_ai/v1/documents/${encodeURIComponent(ref.token)}/fetch`,
                    body: {
                        format: 'xml',
                        extra_param:
                            '{"enable_user_cite_reference_map":true,"return_html5_block_data":true}',
                        export_option: {
                            export_block_id: false,
                            export_style_attrs: false,
                            export_cite_extra_data: false,
                        },
                    },
                });
                const doc = object(result.document);
                if (typeof doc.content !== 'string')
                    fail('Document fetch returned no XML content.');
                xml = String(doc.content);
            } else if (xml.startsWith('@')) xml = await read(xml.slice(1));
            const { breakdown: _breakdown, ...profile } =
                await parser.parse(xml);
            const diagnostics: JsonObject[] = [];
            if (d?.word_count) {
                const w = object(d.word_count);
                if (
                    (w.min !== null && profile.word_count < Number(w.min)) ||
                    (w.max !== null && profile.word_count > Number(w.max))
                ) {
                    const expected = Object.fromEntries(
                        Object.entries(w).filter(([, v]) => v !== null),
                    );
                    diagnostics.push({
                        severity: 'error',
                        code: 'word_count_out_of_range',
                        expected,
                        actual: profile.word_count,
                        msg: 'word_count does not satisfy the Presentation Decision.',
                        suggested: `Adjust word_count to the configured bounds: ${JSON.stringify(expected)}.`,
                    });
                }
            }
            if (d?.visual_plan) {
                for (const item of (object(d.visual_plan)
                    .blocks as unknown[]) ?? []) {
                    const b = object(item);
                    if (b.type == null || b.min_count == null) continue;
                    const actual = profile.blocks
                        .filter((x) =>
                            b.type === 'list'
                                ? ['ul', 'ol'].includes(x.type)
                                : x.type === b.type,
                        )
                        .reduce((n, x) => n + x.count, 0);
                    if (actual < Number(b.min_count))
                        diagnostics.push({
                            severity: 'error',
                            code: 'required_block_missing',
                            expected: { type: b.type, min_count: b.min_count },
                            actual,
                            msg: `The draft is missing required ${b.type} block(s)${b.purpose ? ` for ${b.purpose}` : ''}.`,
                            suggested: `Add at least ${b.min_count} ${b.type} block(s).`,
                        });
                }
            }
            if (d) {
                try {
                    const prepared = await prepareDocumentResources(
                        xml,
                        'xml',
                        {},
                        read,
                    );
                    let index = 0;
                    const groups = new Map<string, JsonObject>();
                    for (const resource of prepared.resources) {
                        if (resource.kind === 'image') index++;
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
                            await files.stat(
                                context.grant.id,
                                resource.artifact,
                            );
                        }
                        if (resource.url) {
                            try {
                                if (!_remote)
                                    throw new Error(
                                        'Remote image service is unavailable.',
                                    );
                                const file = await _remote.read(
                                    resource.url,
                                    20 * 1024 * 1024,
                                );
                                if (
                                    !/^image\/(?:bmp|gif|jpeg|png|tiff|webp)$/u.test(
                                        file.contentType.split(';')[0]!,
                                    )
                                )
                                    throw new Error(
                                        'Content-Type is not supported.',
                                    );
                            } catch (error) {
                                const message =
                                    error instanceof Error
                                        ? error.message
                                        : 'Remote image preflight failed.';
                                const code =
                                    /Content-Type|not a valid|declared/u.test(
                                        message,
                                    )
                                        ? 'remote_image_format_unsupported'
                                        : /20.?MiB|too large|exceeds/u.test(
                                                message,
                                            )
                                          ? 'remote_image_too_large'
                                          : /not allowed|absolute|invalid remote/u.test(
                                                  message,
                                              )
                                            ? 'remote_image_source_disallowed'
                                            : 'remote_image_unavailable';
                                const safe = message.replace(
                                    /https?:\/\/\S+/gu,
                                    '[redacted URL]',
                                );
                                const key = code + '\0' + safe;
                                const previous = groups.get(key);
                                if (previous)
                                    (previous.image_indices as number[]).push(
                                        index,
                                    );
                                else {
                                    const diagnostic = {
                                        severity: 'error',
                                        code,
                                        msg: safe,
                                        image_indices: [index],
                                        suggested:
                                            'Upload a supported image below 20 MiB as a private artifact and use its @artifact handle.',
                                    };
                                    groups.set(key, diagnostic);
                                    diagnostics.push(diagnostic);
                                }
                            }
                        }
                    }
                } catch (error) {
                    diagnostics.push({
                        severity: 'error',
                        code: 'resource_preflight_failed',
                        msg:
                            error instanceof Error
                                ? error.message
                                : 'Resource preflight failed.',
                    });
                }
            }
            return {
                assessment: {
                    status: diagnostics.length ? 'failed' : 'passed',
                },
                profile,
                ...(diagnostics.length ? { diagnostics } : {}),
            };
        },
    };
}

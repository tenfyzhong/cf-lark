import type { WorkflowRunner } from '../../ports/workflows';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { slidesMutationDefinitions } from './mutation-definitions';
import { presentationRef, resolvePresentation } from './commands';
import { stampXML, validateXML } from './xml';
const fail = (message: string): never => {
    throw new ServiceError('INVALID_ARGUMENTS', message);
};
function required(args: JsonObject, key: string): string {
    const v = String(args[key] ?? '').trim();
    if (!v) fail(`${key} is required.`);
    return v;
}
function parts(raw: unknown): {
    parts: JsonObject[];
    normalizations: JsonObject[];
} {
    let parsed: unknown;
    try {
        parsed = JSON.parse(String(raw));
    } catch {
        return fail('parts must be a JSON array.');
    }
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 200)
        fail('parts requires between 1 and 200 entries.');
    const normalizations: JsonObject[] = [];
    const result = (parsed as unknown[]).map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            fail('Each part must be an object.');
        const p = { ...(value as JsonObject) };
        const aliases: Record<string, string> = {
            replace: 'block_replace',
            insert: 'block_insert',
        };
        if (aliases[String(p.action)]) {
            normalizations.push({
                part_index: index,
                kind: 'action',
                from: p.action,
                to: aliases[String(p.action)],
            });
            p.action = aliases[String(p.action)];
        }
        if (p.action !== 'block_replace' && p.action !== 'block_insert')
            fail('Only block_replace and block_insert actions are supported.');
        const replacement = p.action === 'block_replace';
        const payload = replacement ? 'replacement' : 'insertion';
        for (const alias of [
            ...(replacement ? ['target_id'] : []),
            'block',
            'content',
            'element',
            'shape',
        ]) {
            if (p[alias] === undefined) continue;
            const canonical = alias === 'target_id' ? 'block_id' : payload;
            if (p[canonical] !== undefined && p[canonical] !== p[alias])
                fail(`Conflicting ${alias} and ${canonical}.`);
            p[canonical] = p[alias];
            delete p[alias];
            normalizations.push({
                part_index: index,
                kind: 'field',
                from: alias,
                to: canonical,
            });
        }
        const fields = replacement
            ? ['action', 'block_id', 'replacement']
            : ['action', 'insertion', 'insert_before_block_id'];
        if (Object.keys(p).some((k) => !fields.includes(k)))
            fail('Unknown part field.');
        if (Object.values(p).some((v) => typeof v !== 'string'))
            fail('Part fields must be strings.');
        const xml = required(p, payload);
        validateXML(xml);
        if (replacement) p[payload] = stampXML(xml, required(p, 'block_id'));
        else p[payload] = xml;
        return p;
    });
    return { parts: result, normalizations };
}
export function prepareSlideMutation(
    name: string,
    args: JsonObject,
    id: string,
): { request: ApiRequest; normalizations?: JsonObject[] } {
    const revision = args['revision-id'] ?? -1;
    if (!Number.isSafeInteger(revision) || Number(revision) < -1)
        fail('Invalid revision-id.');
    const path = `/open-apis/slides_ai/v1/xml_presentations/${encodeURIComponent(id)}/slide`;
    if (name === 'add-slide') {
        const content = required(args, 'slide');
        validateXML(content, 'slide', false);
        return {
            request: {
                method: 'POST',
                path,
                query: { revision_id: revision },
                body: {
                    slide: { content },
                    ...(args['before-slide-id']
                        ? {
                              before_slide_id: String(
                                  args['before-slide-id'],
                              ).trim(),
                          }
                        : {}),
                    lint_xml: args['no-lint'] !== true,
                },
            },
        };
    }
    const slideId = required(args, 'slide-id');
    let prepared: { parts: JsonObject[]; normalizations?: JsonObject[] };
    if (name === 'replace-slide') prepared = parts(args.parts);
    else {
        const values = [
            'content',
            'xml',
            'slide-xml',
            'slide-content',
            'content-xml',
        ]
            .filter((k) => args[k] !== undefined)
            .map((k) => String(args[k]).trim());
        if (values.length === 0 || new Set(values).size !== 1)
            fail('Provide one unambiguous full slide XML content.');
        prepared = {
            parts: [
                {
                    action: 'block_replace',
                    block_id: slideId,
                    replacement: stampXML(values[0]!, slideId, true),
                },
            ],
        };
    }
    return {
        request: {
            method: 'POST',
            path: `${path}/replace`,
            query: {
                slide_id: slideId,
                revision_id: revision,
                ...(args.tid ? { tid: String(args.tid).trim() } : {}),
            },
            body: { parts: prepared.parts, lint_xml: args['no-lint'] !== true },
        },
        normalizations: prepared.normalizations,
    };
}
export function slidesMutationCapabilities(
    workflows?: WorkflowRunner,
): Capability[] {
    return slidesMutationDefinitions.map((definition) => {
        const name = definition.id.slice(8);
        return {
            definition,
            preview: async (args) => {
                const ref = presentationRef(args);
                if (
                    Object.values(args).some(
                        (v) => typeof v === 'string' && v.startsWith('@'),
                    )
                )
                    return {
                        workflow: 'slides-authoring',
                        command: name,
                        artifactInputs: true,
                    };
                return {
                    ...prepareSlideMutation(
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
                if (
                    Object.values(args).some(
                        (v) => typeof v === 'string' && v.includes('@'),
                    )
                ) {
                    if (!workflows)
                        throw new ServiceError(
                            'WORKFLOW_REQUIRED',
                            'Artifact-backed slide mutations require the workflow runtime.',
                        );
                    return workflows.start(
                        'slides-authoring',
                        { phase: 'start', command: name, args },
                        context.selection,
                        context.grant,
                    );
                }
                prepareSlideMutation(name, args, 'validate');
                const id = await resolvePresentation(args, context);
                const prepared = prepareSlideMutation(name, args, id);
                const data = await context.lark.request(prepared.request);
                return {
                    xml_presentation_id: id,
                    ...(args['slide-id']
                        ? { slide_id: String(args['slide-id']).trim() }
                        : {}),
                    ...(name === 'replace-slide'
                        ? {
                              parts_count: (
                                  (prepared.request.body as JsonObject)
                                      .parts as unknown[]
                              ).length,
                          }
                        : {}),
                    ...(prepared.normalizations?.length
                        ? { normalizations: prepared.normalizations }
                        : {}),
                    ...data,
                };
            },
        };
    });
}

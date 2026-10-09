import type { ArtifactFiles } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
import type { MailTransformer } from '../../ports/mail';
import type { WorkflowProgram } from '../../ports/workflows';
import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import { attachmentInputs } from './compose';
import { invalid, mailbox, path, type Data } from './common';
import { readMailText } from './files';
import { mailUploadStep } from './upload';
const maxContent = 3 * 1024 * 1024,
    maxSmall = 25 * 1024 * 1024;
const byteLength = (value: string) =>
    new TextEncoder().encode(value).byteLength;
const escape = (value: string) =>
    value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&#34;')
        .replaceAll("'", '&#39;');
const normalizeCID = (value: unknown) =>
    String(value ?? '')
        .trim()
        .replace(/^cid:/i, '')
        .replace(/^<|>$/g, '')
        .trim();
const imgPattern = /<img\s(?:[^>]*?\s)?src\s*=\s*["']([^"']+)["']/gi;
function references(body: string): string[] {
    return [...body.matchAll(imgPattern)].map((match) => match[1]!.trim());
}
function localImages(body: string): string[] {
    return references(body).filter(
        (src) =>
            src && !src.startsWith('//') && !/^[a-z][a-z0-9+.\-]*:/i.test(src),
    );
}
function skeleton(): Data {
    return {
        name: 'string (at most 100 chars, optional)',
        subject: 'string (optional)',
        template_content:
            'string (HTML or plain text; local img sources use private artifacts)',
        is_plain_text_mode: 'bool (optional)',
        ...Object.fromEntries(
            ['tos', 'ccs', 'bccs'].map((key) => [
                key,
                [{ mail_address: 'string', name: 'string(optional)' }],
            ]),
        ),
    };
}
function extract(response: Data): Data {
    const template = response.template ?? response;
    if (!template || typeof template !== 'object' || Array.isArray(template))
        throw new ServiceError(
            'INVALID_UPSTREAM_RESPONSE',
            'Template response has no template object.',
            502,
        );
    return template;
}
export function templatePlan(
    action: string,
    args: Data,
    context?: Pick<CommandContext, 'selection'>,
): Data {
    const updating = action === 'template-update';
    if (updating && args['print-patch-template']) return { local: skeleton() };
    const mb = mailbox(args, context, true),
        prefix = updating ? 'set-' : '';
    if (updating) {
        const id = String(args['template-id'] ?? '');
        if (
            !/^[+-]?\d+$/.test(id) ||
            BigInt(id) < -(1n << 63n) ||
            BigInt(id) > (1n << 63n) - 1n
        )
            invalid('template-id must be a decimal integer string.');
    }
    if (!updating && (typeof args.name !== 'string' || !args.name.trim()))
        invalid('name is required.');
    if ([...String(args[`${prefix}name`] ?? '')].length > 100)
        invalid('Template name must be at most 100 characters.');
    if (
        args[`${prefix}template-content`] &&
        args[`${prefix}template-content-file`]
    )
        invalid('Template content and content-file are mutually exclusive.');
    const inline = attachmentInputs(args.inline, true),
        files = attachmentInputs(args.attach, false);
    if (!updating && args['plain-text'] && inline.length)
        invalid('Inline images require HTML and cannot use plain-text mode.');
    return {
        mailbox: mb,
        updating,
        inline,
        files,
        requests: [
            ...(updating
                ? [
                      {
                          method: 'GET',
                          path: path(mb, 'templates', args['template-id']),
                      },
                  ]
                : []),
            ...(!args.inspect
                ? [
                      {
                          method: updating ? 'PUT' : 'POST',
                          path: path(
                              mb,
                              'templates',
                              ...(updating ? [args['template-id']] : []),
                          ),
                          body: { template: '<prepared template>' },
                      },
                  ]
                : []),
        ],
    };
}
function validateCIDs(
    body: string,
    existing: Data[],
    inline: Data[],
    strict: boolean,
): void {
    const old = existing.filter((file) => file.is_inline && file.cid),
        all = [
            ...old.map((file) => normalizeCID(file.cid)),
            ...inline.map((file) => normalizeCID(file.cid)),
        ];
    const normalized = all.map((cid) => cid.toLowerCase());
    if (
        (strict || inline.length) &&
        new Set(normalized).size !== normalized.length
    )
        invalid('Template inline CIDs must be unique.');
    if (!strict && !inline.length) return;
    const refs = references(body)
        .filter((src) => /^cid:/i.test(src))
        .map((src) => normalizeCID(src).toLowerCase());
    if (refs.some((cid) => !normalized.includes(cid)))
        invalid('HTML references a CID without a matching attachment.');
    if (
        inline.some(
            (file) => !refs.includes(normalizeCID(file.cid).toLowerCase()),
        )
    )
        invalid('An inline attachment CID is not referenced in the HTML.');
}
export function templateProgram(
    artifacts?: ArtifactFiles,
    pure?: MailTransformer,
): WorkflowProgram {
    return {
        id: 'mail-template',
        version: 1,
        domain: 'mail',
        risk: 'write',
        identities: ['user', 'bot'],
        step: async (input, context) => {
            const state = input as Data,
                args = state.args as Data;
            const next = (patch: Data) => ({
                done: false as const,
                state: { ...state, ...patch },
            });
            if (state.phase === 'start') {
                const plan = templatePlan(state.action, args, context);
                if (plan.local) return { done: true, output: plan.local };
                return next({
                    ...plan,
                    phase: plan.updating ? 'fetch' : 'prepare',
                    template: {
                        name: args.name ?? '',
                        subject: args.subject ?? '',
                        template_content: '',
                        is_plain_text_mode: args['plain-text'] === true,
                    },
                    offset: 0,
                });
            }
            if (state.phase === 'fetch') {
                const template = extract(
                    await context.lark.request({
                        method: 'GET',
                        path: path(
                            state.mailbox,
                            'templates',
                            args['template-id'],
                        ),
                    }),
                );
                if (args.inspect) return { done: true, output: { template } };
                return next({ template, phase: 'prepare' });
            }
            if (state.phase === 'prepare') {
                if (!pure) invalid('Mail transformations are unavailable.');
                const template = structuredClone(state.template),
                    prefix = state.updating ? 'set-' : '';
                if (state.updating) {
                    for (const field of ['name', 'subject'])
                        if (args[`set-${field}`])
                            template[field] = args[`set-${field}`];
                    if (args['set-plain-text'])
                        template.is_plain_text_mode = true;
                }
                const contentFlag = `${prefix}template-content`,
                    fileFlag = `${contentFlag}-file`;
                const content = args[fileFlag]
                    ? await readMailText(
                          String(args[fileFlag]),
                          context,
                          artifacts,
                          maxContent,
                      )
                    : String(args[contentFlag] ?? '');
                let changed = !state.updating || !!content;
                if (changed) template.template_content = content;
                for (const [flag, field] of [
                    ['to', 'tos'],
                    ['cc', 'ccs'],
                    ['bcc', 'bccs'],
                ])
                    if (!state.updating || Object.hasOwn(args, `set-${flag}`)) {
                        const values = args[`${prefix}${flag}`];
                        const parsed = (await pure.processMail({
                            operation: 'addresses',
                            addresses: Array.isArray(values)
                                ? values.join(',')
                                : String(values ?? ''),
                        })) as Data[];
                        template[field!] = parsed.map((value) => ({
                            mail_address: value.address ?? value.email,
                            ...(value.name ? { name: value.name } : {}),
                        }));
                    }
                if (args['patch-file']) {
                    let patch: Data;
                    try {
                        patch = JSON.parse(
                            await readMailText(
                                String(args['patch-file']),
                                context,
                                artifacts,
                                maxContent,
                            ),
                        );
                    } catch (error) {
                        if (error instanceof ServiceError) throw error;
                        return invalid('patch-file must contain valid JSON.');
                    }
                    if (
                        !patch ||
                        typeof patch !== 'object' ||
                        Array.isArray(patch)
                    )
                        invalid('Template patch must be an object.');
                    for (const key of [
                        'name',
                        'subject',
                        'template_content',
                        'is_plain_text_mode',
                        'tos',
                        'ccs',
                        'bccs',
                    ])
                        if (patch[key] !== undefined && patch[key] !== null) {
                            if (
                                ['tos', 'ccs', 'bccs'].includes(key)
                                    ? !Array.isArray(patch[key])
                                    : typeof patch[key] !==
                                      (key === 'is_plain_text_mode'
                                          ? 'boolean'
                                          : 'string')
                            )
                                invalid(`Invalid patch field ${key}.`);
                            template[key] = patch[key];
                            if (key === 'template_content') changed = true;
                        }
                }
                if (template.is_plain_text_mode && state.inline.length)
                    invalid(
                        'Inline images require HTML and cannot use plain-text mode.',
                    );
                let body = String(template.template_content ?? '');
                if (
                    changed &&
                    body &&
                    !(await pure.processMail({ operation: 'is-html', body }))
                )
                    body = `<div style="word-break:break-word;line-height:1.6;font-size:14px;color:rgb(0,0,0);">${escape(body).replaceAll('\n', '<br>')}</div>`;
                if (byteLength(body) > maxContent)
                    invalid('Template content exceeds 3 MiB.');
                const refs = references(body)
                    .filter((src) => /^cid:/i.test(src))
                    .map((src) => normalizeCID(src).toLowerCase());
                const retained = (template.attachments ?? [])
                    .filter(
                        (file: Data) =>
                            !(
                                changed &&
                                file.is_inline &&
                                file.cid &&
                                !refs.includes(
                                    normalizeCID(file.cid).toLowerCase(),
                                )
                            ),
                    )
                    .map((file: Data) => ({
                        ...file,
                        body: file.body || file.id,
                    }));
                validateCIDs(body, retained, state.inline, changed);
                const uploads: Data[] = [],
                    seen = new Map<string, string>();
                for (const source of localImages(body)) {
                    let cid = seen.get(source);
                    if (!cid) {
                        cid = crypto.randomUUID();
                        seen.set(source, cid);
                        uploads.push({
                            id: source.replace(/^@/, ''),
                            name: source.replace(/^@/, '').split(/[\\/]/).pop(),
                            cid,
                            is_inline: true,
                        });
                    }
                    body = body.replace(imgPattern, (match, src: string) =>
                        src.trim() === source
                            ? match.replace(src, `cid:${cid}`)
                            : match,
                    );
                }
                uploads.push(
                    ...state.inline.map((file: Data) => ({
                        ...file,
                        is_inline: true,
                    })),
                    ...state.files.map((file: Data) => ({
                        ...file,
                        is_inline: false,
                    })),
                );
                if (uploads.length && context.selection.identity !== 'user')
                    invalid(
                        'Template attachment upload requires user identity.',
                    );
                template.template_content = body;
                template.attachments = retained;
                const projected =
                    2048 +
                    Math.floor(
                        (byteLength(
                            String(template.name ?? '') +
                                String(template.subject ?? '') +
                                body,
                        ) *
                            4) /
                            3,
                    ) +
                    200 +
                    ['tos', 'ccs', 'bccs'].reduce(
                        (sum, field) =>
                            sum +
                            (template[field] ?? []).reduce(
                                (n: number, address: Data) =>
                                    n +
                                    byteLength(
                                        String(address.mail_address ?? '') +
                                            String(address.name ?? ''),
                                    ) +
                                    16,
                                0,
                            ),
                        0,
                    );
                return next({
                    template,
                    uploads,
                    projected,
                    rawSmall: byteLength(body),
                    largeBucket: false,
                    offset: 0,
                    phase: uploads.length ? 'identity' : 'write',
                });
            }
            if (state.phase === 'identity') {
                const data = await context.lark.request({
                    method: 'GET',
                    path: '/open-apis/authen/v1/user_info',
                });
                const openId = data.open_id || (data.data as Data)?.open_id;
                if (!openId)
                    invalid(
                        'Template attachment upload requires an authenticated user open ID.',
                    );
                return next({ openId, phase: 'upload' });
            }
            if (state.phase === 'upload') {
                if (!artifacts) invalid('Artifact storage is unavailable.');
                authorize(
                    context.grant,
                    { ...context.selection, domain: 'artifact', risk: 'read' },
                    Date.now(),
                );
                const file = state.uploads[state.offset];
                if (!state.upload) {
                    const metadata = await artifacts.stat(
                        context.grant.id,
                        file.id,
                    );
                    return next({
                        upload: {
                            phase: 'prepare',
                            file: { ...file, size: metadata.size },
                            openId: state.openId,
                        },
                    });
                }
                const result = await mailUploadStep(
                    state.upload,
                    context,
                    artifacts,
                );
                if (!result.done) return next({ upload: result.state });
                const encoded = Math.floor((result.size * 4 + 2) / 3) + 200;
                const large =
                    !file.is_inline &&
                    (state.largeBucket ||
                        state.projected + encoded >= maxSmall ||
                        state.rawSmall + result.size > maxSmall);
                const projected = state.projected + (large ? 0 : encoded),
                    rawSmall = state.rawSmall + (large ? 0 : result.size);
                if (rawSmall > maxSmall)
                    invalid('Template body plus inline images exceeds 25 MiB.');
                const duplicate = state.template.attachments.some(
                    (existing: Data) =>
                        existing.id === result.file_token &&
                        String(existing.cid ?? '') === String(file.cid ?? ''),
                );
                const template = {
                    ...state.template,
                    attachments: [
                        ...state.template.attachments,
                        ...(duplicate
                            ? []
                            : [
                                  {
                                      id: result.file_token,
                                      filename: file.name,
                                      ...(file.cid ? { cid: file.cid } : {}),
                                      is_inline: file.is_inline,
                                      attachment_type: large ? 2 : 1,
                                      body: result.file_token,
                                  },
                              ]),
                    ],
                };
                return next({
                    template,
                    projected,
                    rawSmall,
                    largeBucket: state.largeBucket || large,
                    offset: state.offset + 1,
                    upload: null,
                    phase:
                        state.offset + 1 === state.uploads.length
                            ? 'write'
                            : 'upload',
                });
            }
            if (state.phase === 'write') {
                const template = state.template;
                if (!state.updating)
                    validateCIDs(
                        template.template_content,
                        [],
                        template.attachments.filter(
                            (file: Data) => file.is_inline,
                        ),
                        true,
                    );
                const response = await context.lark.request({
                    method: state.updating ? 'PUT' : 'POST',
                    path: path(
                        state.mailbox,
                        'templates',
                        ...(state.updating ? [args['template-id']] : []),
                    ),
                    body: { template },
                });
                return { done: true, output: { template: extract(response) } };
            }
            throw new ServiceError(
                'INVALID_WORKFLOW_STATE',
                'Unknown template workflow phase.',
                500,
            );
        },
    };
}

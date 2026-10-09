import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
import type { MailTransformer } from '../../ports/mail';
import type { WorkflowProgram } from '../../ports/workflows';
import { invalid, list, mailbox, path, required, type Data } from './common';
import { renderSignature } from './delivery';
import { readMailText } from './files';
import type { RemoteFiles } from '../../ports/remote-files';
import { streamMailDraftJSON, type MailStreamPart } from './stream';
import { localMailImages } from './images';
import { mailResourceStep } from './resources';
import { mailUploadStep } from './upload';
import { decode } from './read';
const escape = (text: string) =>
    text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
export function composePlan(
    action: string,
    args: Data,
    context?: Pick<CommandContext, 'selection'>,
): Data {
    const mb = mailbox(args, context, true),
        receipt = action === 'send-receipt',
        source = ['reply', 'reply-all', 'forward', 'send-receipt'].includes(
            action,
        );
    if (source) required(args['message-id'], 'message-id');
    if (args.body && args['body-file'])
        invalid('body and body-file are mutually exclusive.');
    if (args['no-signature'] && args['signature-id'])
        invalid('no-signature and signature-id are mutually exclusive.');
    if (
        args.priority &&
        !['high', 'normal', 'low'].includes(
            String(args.priority).trim().toLowerCase(),
        )
    )
        invalid('priority must be high, normal or low.');
    for (const key of ['subject', 'from', 'mailbox', 'to', 'cc', 'bcc']) {
        const value = args[key];
        if (
            value !== undefined &&
            (Array.isArray(value) ? value : [value]).some(
                (v) => typeof v !== 'string' || /[\r\n\0]/.test(v),
            )
        )
            invalid(`Invalid ${key}.`);
    }
    if (!receipt && !args['template-id']) {
        if (!args.body?.trim() && !args['body-file'])
            invalid('A body or body-file is required.');
        if (
            ['send', 'draft-create'].includes(action) &&
            !String(args.subject ?? '').trim()
        )
            invalid('A subject is required.');
        if (
            ['send', 'forward'].includes(action) &&
            ![args.to, args.cc, args.bcc].some((v) =>
                Array.isArray(v) ? v.length : !!v,
            )
        )
            invalid('At least one recipient is required.');
    }
    if (args['send-time'] && !/^\d+$/.test(String(args['send-time'])))
        invalid('send-time must be Unix seconds.');
    if (args['send-time'] && !args['confirm-send'])
        invalid('send-time requires confirm-send.');
    const event = [
        'event-summary',
        'event-start',
        'event-end',
        'event-location',
    ].some((k) => args[k]);
    if (event) {
        for (const k of ['event-summary', 'event-start', 'event-end'])
            required(args[k], k);
        for (const k of ['event-start', 'event-end'])
            if (
                !/(Z|[+-]\d\d:\d\d)$/.test(args[k]) ||
                !Number.isFinite(Date.parse(args[k]))
            )
                invalid('Calendar times require ISO 8601 timezone offsets.');
        if (Date.parse(args['event-end']) <= Date.parse(args['event-start']))
            invalid('Event end must follow start.');
    }
    const files = attachmentInputs(args.attach, false),
        inline = attachmentInputs(args.inline, true);
    if (files.length > 500) invalid('At most 500 attachments are allowed.');
    if (args['plain-text'] && inline.length)
        invalid('Inline images require HTML.');
    return {
        mailbox: mb,
        source,
        receipt,
        files,
        inline,
        requests: [
            ...(source
                ? [
                      {
                          method: 'GET',
                          path: path(mb, 'messages', args['message-id']),
                          query: {
                              format: receipt ? 'plain_text_full' : 'full',
                          },
                      },
                  ]
                : []),
            {
                method: 'POST',
                path: path(mb, 'drafts'),
                body: { raw: '<base64url MIME>' },
            },
            ...(args['confirm-send'] || receipt
                ? [
                      {
                          method: 'POST',
                          path: path(mb, 'drafts', '<draft_id>', 'send'),
                      },
                  ]
                : []),
        ],
    };
}
export function attachmentInputs(value: unknown, inline: boolean): Data[] {
    if (value === undefined || value === '') return [];
    let input: unknown = value;
    if (typeof input === 'string' && /^[\[{]/.test(input.trim())) {
        try {
            input = JSON.parse(input);
        } catch {
            invalid('Invalid attachment JSON.');
        }
    }
    const entries = Array.isArray(input) ? input : [input],
        out: Data[] = [];
    for (const entry of entries) {
        if (typeof entry === 'string' && !inline) {
            for (const id of entry
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean))
                out.push({
                    id: id.replace(/^@/, ''),
                    name: id.replace(/^@/, '').split(/[\\/]/).pop(),
                });
            continue;
        }
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            invalid('Inline entries require cid and file_path.');
        const e = entry as Data,
            id = required(
                e.artifactId || e.id || e.file_path,
                'artifact ID',
            ).replace(/^@/, ''),
            name = String(e.name || e.filename || id.split(/[\\/]/).pop());
        if (/[\r\n\0]/.test(name)) invalid('Invalid attachment filename.');
        const cid = String(e.cid || '')
            .replace(/^cid:/i, '')
            .replace(/^<|>$/g, '')
            .trim();
        if (inline && !cid) invalid('Inline cid is required.');
        out.push({ id, name, ...(cid ? { cid } : {}) });
    }
    if (
        new Set(out.filter((e) => e.cid).map((e) => e.cid)).size !==
        out.filter((e) => e.cid).length
    )
        invalid('Inline CIDs must be unique.');
    return out;
}
export async function artifactPart(
    file: Data,
    context: CommandContext,
    artifacts: ArtifactFiles | undefined,
): Promise<Data> {
    if (!artifacts) invalid('Artifact storage is unavailable.');
    if (!file.internal)
        authorize(
            context.grant,
            { ...context.selection, domain: 'artifact', risk: 'read' },
            Date.now(),
        );
    const meta = await artifacts.stat(context.grant.id, file.id);
    if (meta.size > 25 * 1024 * 1024)
        invalid(
            'This attachment requires the large attachment upload workflow.',
        );
    const response = await artifacts.read(context.grant.id, file.id),
        bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== meta.size) invalid('Artifact size mismatch.');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768)
        binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + 32768),
        );
    return {
        name: file.name,
        data: btoa(binary),
        ...(file.cid ? { cid: file.cid } : {}),
    };
}
function primary(data: Data): string {
    return String(
        data.primary_email_address || data.data?.primary_email_address || '',
    );
}
function sourceAddress(value: unknown): Data[] {
    if (typeof value === 'string') return value ? [{ address: value }] : [];
    if (Array.isArray(value)) return value.flatMap(sourceAddress);
    if (value && typeof value === 'object') {
        const v = value as Data;
        return v.address || v.mail_address
            ? [
                  {
                      address: v.address || v.mail_address,
                      ...(v.name ? { name: v.name } : {}),
                  },
              ]
            : [];
    }
    return [];
}
export function composeProgram(
    artifacts?: ArtifactFiles,
    pure?: MailTransformer,
    remote?: RemoteFiles,
): WorkflowProgram {
    return {
        id: 'mail-compose',
        version: 1,
        domain: 'mail',
        risk: 'write',
        identities: ['user'],
        step: async (input, context) => {
            const s: Data = input,
                a = s.args;
            if (!pure) invalid('Mail transformations are unavailable.');
            if (s.phase === 'start') {
                const plan = composePlan(s.action, a, context);
                return {
                    done: false,
                    state: {
                        ...s,
                        ...plan,
                        phase: plan.source ? 'source' : 'profile',
                        sender:
                            a.from ||
                            (a.mailbox && a.mailbox !== 'me' ? a.mailbox : ''),
                        original: {},
                        template: {},
                        signatures: {},
                    },
                };
            }
            if (s.phase === 'source') {
                const data = await context.lark.request(s.requests[0]);
                if (!data.message)
                    throw new ServiceError(
                        'INVALID_UPSTREAM_RESPONSE',
                        'Response has no original message.',
                    );
                const original = data.message as Data;
                if (
                    s.receipt &&
                    !(original.label_ids ?? []).some((v: string) =>
                        ['READ_RECEIPT_REQUEST', '-607'].includes(v),
                    )
                )
                    invalid('Original message did not request a receipt.');
                return {
                    done: false,
                    state: { ...s, original, phase: 'profile' },
                };
            }
            if (s.phase === 'profile') {
                let sender = s.sender,
                    self = '';
                if (!sender || s.action === 'reply-all') {
                    const data = await context.lark.request({
                        method: 'GET',
                        path: path('me', 'profile'),
                    });
                    self = primary(data);
                    sender = sender || self;
                }
                if (!sender)
                    invalid('Unable to resolve the sender; provide from.');
                return {
                    done: false,
                    state: { ...s, sender, self, phase: 'template' },
                };
            }
            if (s.phase === 'template') {
                let template = s.template;
                if (a['template-id']) {
                    const data = await context.lark.request({
                        method: 'GET',
                        path: path(s.mailbox, 'templates', a['template-id']),
                    });
                    template = data.template ?? data;
                }
                return {
                    done: false,
                    state: { ...s, template, phase: 'signature' },
                };
            }
            if (s.phase === 'signature') {
                let signatures: Data = {};
                if (!a['no-signature'] && !s.receipt) {
                    try {
                        signatures = await context.lark.request({
                            method: 'GET',
                            path: path(s.mailbox, 'settings', 'signatures'),
                        });
                    } catch (error) {
                        if (a['signature-id']) throw error;
                    }
                }
                return {
                    done: false,
                    state: { ...s, signatures, phase: 'build' },
                };
            }
            if (s.phase === 'resources') {
                if (!artifacts || !remote)
                    invalid(
                        'Mail attachment download services are unavailable.',
                    );
                const result = await mailResourceStep(
                    s.resourceState,
                    context,
                    artifacts,
                    remote,
                );
                if (!result.done)
                    return {
                        done: false,
                        state: { ...s, resourceState: result.state },
                    };
                return {
                    done: false,
                    state: {
                        ...s,
                        resourceState: null,
                        resourceFiles: result.files,
                        resourcesComplete: true,
                        phase: 'build',
                    },
                };
            }
            if (s.phase === 'upload-owner') {
                const data = await context.lark.request({
                    method: 'GET',
                    path: '/open-apis/authen/v1/user_info',
                });
                if (!data.open_id) invalid('Current user has no open_id.');
                return {
                    done: false,
                    state: {
                        ...s,
                        openId: data.open_id,
                        phase: 'upload-large',
                        uploadIndex: 0,
                        uploaded: [],
                    },
                };
            }
            if (s.phase === 'upload-large') {
                if (!artifacts) invalid('Artifact storage is unavailable.');
                const file = s.largeFiles[s.uploadIndex];
                const result = await mailUploadStep(
                    s.uploadState ?? {
                        phase: 'prepare',
                        file,
                        openId: s.openId,
                    },
                    context,
                    artifacts,
                );
                if (!result.done)
                    return {
                        done: false,
                        state: { ...s, uploadState: result.state },
                    };
                const uploaded = [
                        ...s.uploaded,
                        {
                            name: file.name,
                            size: file.size,
                            token: result.file_token,
                        },
                    ],
                    index = s.uploadIndex + 1;
                return {
                    done: false,
                    state: {
                        ...s,
                        uploaded,
                        uploadState: null,
                        uploadIndex: index,
                        phase:
                            index < s.largeFiles.length
                                ? 'upload-large'
                                : 'build',
                        uploadsComplete: index === s.largeFiles.length,
                    },
                };
            }
            if (s.phase === 'build') {
                const parse = async (v: unknown): Promise<Data[]> =>
                    pure.processMail({
                        operation: 'addresses',
                        addresses: Array.isArray(v)
                            ? v.join(',')
                            : String(v ?? ''),
                    }) as Promise<Data[]>;
                const original = s.original,
                    tpl = s.template,
                    from = { address: s.sender },
                    to = await parse(a.to),
                    cc = await parse(a.cc),
                    bcc = await parse(a.bcc);
                const append = (target: Data[], values: Data[]) => {
                    for (const value of values)
                        if (
                            !target.some(
                                (v) =>
                                    v.address.toLowerCase() ===
                                    value.address.toLowerCase(),
                            )
                        )
                            target.push(value);
                };
                if (['reply', 'reply-all'].includes(s.action)) {
                    const sender = sourceAddress(original.reply_to);
                    if (!sender.length)
                        sender.push(...sourceAddress(original.head_from));
                    const extra = [...to];
                    to.splice(0, to.length, ...sender);
                    append(to, extra);
                    if (s.action === 'reply-all') {
                        append(to, sourceAddress(original.head_to));
                        append(cc, sourceAddress(original.head_cc));
                        const remove = [
                            s.sender,
                            s.self,
                            s.mailbox,
                            ...list(a.remove),
                        ].map((v: string) => v.toLowerCase());
                        for (const group of [to, cc])
                            for (let i = group.length - 1; i >= 0; i--)
                                if (
                                    remove.includes(
                                        group[i]!.address.toLowerCase(),
                                    )
                                )
                                    group.splice(i, 1);
                    }
                }
                if (s.receipt) {
                    to.splice(
                        0,
                        to.length,
                        ...sourceAddress(original.head_from),
                    );
                    if (!to.length) invalid('Original sender is missing.');
                }
                for (const [target, key] of [
                    [to, 'tos'],
                    [cc, 'ccs'],
                    [bcc, 'bccs'],
                ] as [Data[], string][]) {
                    target.push(...sourceAddress(tpl[key]));
                }
                if (to.length + cc.length + bcc.length > 500)
                    invalid('At most 500 recipients are supported.');
                if (
                    s.action !== 'draft-create' &&
                    !to.length &&
                    !cc.length &&
                    !bcc.length
                )
                    invalid('At least one recipient is required.');
                let body = a['body-file']
                        ? await readMailText(
                              String(a['body-file']),
                              context,
                              artifacts,
                              8 << 20,
                          )
                        : String(a.body ?? ''),
                    subject = String(a.subject || tpl.subject || ''),
                    plain = a['template-id']
                        ? tpl.is_plain_text_mode === true
                        : a['plain-text'] === true;
                if (a['template-id'])
                    body = (await pure.processMail({
                        operation: 'template-body',
                        action: s.action,
                        body,
                        template: tpl,
                    })) as string;
                let html =
                    !plain &&
                    (await pure.processMail({ operation: 'is-html', body })) ===
                        true;
                let signature: Data | undefined;
                const usage = (s.signatures.usages ?? []).find(
                        (v: Data) =>
                            String(v.email_address).toLowerCase() ===
                            s.sender.toLowerCase(),
                    ),
                    signatureId =
                        a['signature-id'] ||
                        (['reply', 'reply-all', 'forward'].includes(s.action)
                            ? usage?.reply_signature_id
                            : usage?.send_mail_signature_id);
                if (signatureId && signatureId !== '0') {
                    signature = (s.signatures.signatures ?? []).find(
                        (v: Data) => v.id === signatureId,
                    );
                    if (!signature && a['signature-id'])
                        invalid('Signature not found.');
                }
                if (!s.resourcesComplete && !s.receipt) {
                    const items: Data[] = [];
                    for (const att of original.attachments ?? []) {
                        const cid = String(
                            att.cid || att.content_id || '',
                        ).replace(/^<|>$/g, '');
                        if (
                            (att.is_inline && !plain && cid) ||
                            (s.action === 'forward' &&
                                !att.is_inline &&
                                att.attachment_type !== 2)
                        )
                            items.push({
                                source: 'message',
                                key: att.id,
                                name: att.filename || att.file_name || att.id,
                                ...(att.is_inline ? { cid } : {}),
                            });
                    }
                    for (const att of tpl.attachments ?? []) {
                        if (
                            !att.id ||
                            att.attachment_type === 2 ||
                            (att.is_inline && (!att.cid || plain))
                        )
                            continue;
                        items.push({
                            source: 'template',
                            key: att.id,
                            name: att.filename || att.id,
                            ...(att.is_inline ? { cid: att.cid } : {}),
                        });
                    }
                    if (!plain)
                        for (const img of signature?.images ?? [])
                            if (img.download_url && img.cid)
                                items.push({
                                    source: 'signature',
                                    url: img.download_url,
                                    name: img.image_name,
                                    cid: img.cid,
                                });
                    if (items.length)
                        return {
                            done: false,
                            state: {
                                ...s,
                                phase: 'resources',
                                resourceState: {
                                    phase: 'urls',
                                    items,
                                    mailbox: s.mailbox,
                                    messageId: a['message-id'],
                                    templateId: a['template-id'],
                                },
                            },
                        };
                }
                if (signature && !plain) html = true;
                if (s.source && !s.receipt) {
                    const originalBody =
                        decode(original.body_html) ||
                        decode(original.body_plain_text);
                    if (
                        !plain &&
                        (await pure.processMail({
                            operation: 'is-html',
                            body: originalBody,
                        })) === true
                    )
                        html = true;
                    const quote = (await pure.processMail({
                        operation: 'quote',
                        use_html: html,
                        forward: s.action === 'forward',
                        original: {
                            subject: original.subject,
                            from: sourceAddress(original.head_from)[0] ?? {},
                            to: sourceAddress(original.head_to),
                            cc: sourceAddress(original.head_cc),
                            body: originalBody,
                            date: String(
                                original.date || original.internal_date || '',
                            ),
                        },
                    })) as Data;
                    subject = a.subject || quote.subject;
                    body =
                        (html &&
                        !(await pure.processMail({
                            operation: 'is-html',
                            body,
                        }))
                            ? `<div>${escape(body).replace(/\n/g, '<br>')}</div>`
                            : body) + quote.quote;
                }
                if (signature) {
                    const rendered = renderSignature(signature, '', s.sender);
                    if (plain)
                        body +=
                            '\n\n' +
                            (await pure.processMail({
                                operation: 'plain-text',
                                body: rendered,
                            }));
                    else
                        body = (await pure.processMail({
                            operation: 'signature-body',
                            body,
                            signature_id: signature.id,
                            signature_html: rendered,
                        })) as string;
                }
                let receiptBody: Data | undefined;
                if (s.receipt) {
                    receiptBody = (await pure.processMail({
                        operation: 'receipt',
                        subject: String(original.subject ?? ''),
                        from,
                        original_millis: Number(original.internal_date) || 0,
                    })) as Data;
                    subject = receiptBody.subject;
                    body = receiptBody.html;
                    plain = false;
                    html = true;
                }
                if (!subject.trim() || !body.trim())
                    invalid('Effective subject and body must be nonempty.');
                let lint: Data = { lint_applied: [], original_blocked: [] };
                if (html) {
                    lint = (await pure.processMail({
                        operation: 'lint',
                        body,
                    })) as Data;
                    body = lint.cleaned_html ?? '';
                }
                const localImages = html
                    ? localMailImages(body)
                    : { html: body, files: [] };
                body = localImages.html;
                const inlineFiles = [...s.inline, ...localImages.files];
                let normalFiles = s.normalFiles ?? s.files;
                const headers: Data =
                    a.priority && a.priority !== 'normal'
                        ? {
                              'X-Cli-Priority':
                                  a.priority === 'high' ? '1' : '5',
                          }
                        : {};
                if (s.files.length && !s.uploadsComplete) {
                    if (!artifacts) invalid('Artifact storage is unavailable.');
                    authorize(
                        context.grant,
                        {
                            ...context.selection,
                            domain: 'artifact',
                            risk: 'read',
                        },
                        Date.now(),
                    );
                    let budget =
                        2048 +
                        Math.floor(
                            (new TextEncoder().encode(body).length * 4 + 2) / 3,
                        ) +
                        200;
                    for (const file of [
                        ...inlineFiles,
                        ...(s.resourceFiles ?? []),
                    ]) {
                        const meta = await artifacts.stat(
                            context.grant.id,
                            file.id,
                        );
                        budget += Math.floor((meta.size * 4 + 2) / 3) + 200;
                    }
                    const small: Data[] = [],
                        large: Data[] = [];
                    for (const file of s.files) {
                        const meta = await artifacts.stat(
                            context.grant.id,
                            file.id,
                        );
                        const cost = Math.floor((meta.size * 4 + 2) / 3) + 200;
                        if (large.length || budget + cost > 25 * 1024 * 1024)
                            large.push({ ...file, size: meta.size });
                        else {
                            small.push(file);
                            budget += cost;
                        }
                    }
                    if (large.length)
                        return {
                            done: false,
                            state: {
                                ...s,
                                normalFiles: small,
                                largeFiles: large,
                                phase: 'upload-owner',
                            },
                        };
                    normalFiles = small;
                }
                if (s.uploaded?.length) {
                    const card = (await pure.processMail({
                        operation: 'large-attachments',
                        brand: context.lark.brand ?? 'feishu',
                        large: s.uploaded,
                        body,
                        use_html: html,
                    })) as Data;
                    body = html ? card.html : body + card.text;
                    headers['X-Lms-Large-Attachment-Ids'] = card.header;
                }
                const streamClient = context.lark as typeof context.lark & {
                    requestStream?: (request: {
                        method: 'POST';
                        path: string;
                        body: ReadableStream<Uint8Array>;
                    }) => Promise<Data>;
                };
                const streamParts: MailStreamPart[] = [
                    ...normalFiles.map((file: Data) => ({
                        file,
                        kind: 'attachment' as const,
                    })),
                    ...inlineFiles.map((file: Data) => ({
                        file,
                        kind: 'inline' as const,
                    })),
                    ...(s.resourceFiles ?? []).map((file: Data) => ({
                        file,
                        kind: file.cid
                            ? ('inline' as const)
                            : ('attachment' as const),
                    })),
                ];
                const attachments: Data[] = [],
                    inline: Data[] = [];
                if (!streamClient.requestStream)
                    for (const part of streamParts)
                        (part.kind === 'inline' ? inline : attachments).push(
                            await artifactPart(part.file, context, artifacts),
                        );
                if (s.inline.length && !html)
                    invalid('Inline images require HTML.');
                const largeIds = (tpl.attachments ?? [])
                    .filter(
                        (v: Data) =>
                            !v.is_inline && v.attachment_type === 2 && v.id,
                    )
                    .map((v: Data) => ({ id: v.id }));
                if (largeIds.length) {
                    const existing = headers['X-Lms-Large-Attachment-Ids']
                        ? JSON.parse(
                              atob(headers['X-Lms-Large-Attachment-Ids']),
                          )
                        : [];
                    headers['X-Lms-Large-Attachment-Ids'] = btoa(
                        JSON.stringify([...existing, ...largeIds]),
                    );
                }
                let calendar = '';
                if (a['event-summary'])
                    calendar = (await pure.processMail({
                        operation: 'calendar',
                        from,
                        to,
                        cc,
                        event: {
                            summary: a['event-summary'],
                            start: a['event-start'],
                            end: a['event-end'],
                            location: a['event-location'] ?? '',
                        },
                    })) as string;
                else if (s.action === 'forward' && original.body_calendar)
                    calendar = decode(original.body_calendar);
                const smtp = String(original.smtp_message_id ?? '')
                        .trim()
                        .replace(/^<|>$/g, ''),
                    refs = Array.isArray(original.references)
                        ? original.references.join(' ')
                        : String(original.references ?? '');
                const threading = [
                    'reply',
                    'reply-all',
                    'send-receipt',
                ].includes(s.action)
                    ? {
                          in_reply_to: smtp,
                          lms_reply_to: a['message-id'],
                          references: [refs, smtp ? `<${smtp}>` : '']
                              .filter(Boolean)
                              .join(' '),
                      }
                    : {};
                const buildInput = {
                    operation: 'build-eml',
                    from,
                    to,
                    cc,
                    bcc,
                    subject,
                    ...(html
                        ? {
                              html: body,
                              ...(receiptBody
                                  ? { text: receiptBody.text }
                                  : {}),
                          }
                        : { text: body }),
                    calendar,
                    attachments,
                    inline,
                    ...threading,
                    allow_no_recipients: s.action === 'draft-create',
                    request_receipt: a['request-receipt'] === true,
                    is_receipt: s.receipt,
                    headers,
                };
                let data: Data;
                if (
                    streamClient.requestStream &&
                    streamParts.length &&
                    artifacts
                ) {
                    const body = await streamMailDraftJSON(
                        buildInput,
                        streamParts,
                        context,
                        artifacts,
                        pure,
                    );
                    data = await streamClient.requestStream({
                        method: 'POST',
                        path: path(s.mailbox, 'drafts'),
                        body,
                    });
                } else {
                    const built = (await pure.processMail(buildInput)) as Data;
                    data = await context.lark.request({
                        method: 'POST',
                        path: path(s.mailbox, 'drafts'),
                        body: { raw: built.raw },
                    });
                }
                const draftId =
                    data.draft_id ||
                    data.id ||
                    data.draft?.draft_id ||
                    data.draft?.id;
                if (!draftId)
                    throw new ServiceError(
                        'OUTCOME_UNCERTAIN',
                        'Draft creation returned no draft ID.',
                    );
                const result: Data = {
                    draft_id: draftId,
                    ...(data.reference || data.draft?.reference
                        ? { reference: data.reference || data.draft.reference }
                        : {}),
                    ...(a['show-lint-details']
                        ? {
                              lint_applied: lint.lint_applied,
                              original_blocked: lint.original_blocked,
                          }
                        : {}),
                };
                if (
                    s.action === 'draft-create' ||
                    (!a['confirm-send'] && !s.receipt)
                )
                    return {
                        done: true,
                        output: {
                            ...result,
                            ...(s.action === 'draft-create'
                                ? {
                                      draft_edit_hint:
                                          'Edit this draft with mail.+draft-edit.',
                                  }
                                : {
                                      tip: 'Draft saved. Use mail.+draft-send to send it.',
                                  }),
                            compose_hint:
                                'Use mail.+lint-html to preview rich HTML.',
                        },
                    };
                return {
                    done: false,
                    state: { ...s, phase: 'send', draftId, result },
                };
            }
            const data = await context.lark.request({
                method: 'POST',
                path: path(s.mailbox, 'drafts', s.draftId, 'send'),
                ...(a['send-time']
                    ? { body: { send_time: String(a['send-time']) } }
                    : {}),
            });
            return {
                done: true,
                output: {
                    ...data,
                    ...(s.receipt
                        ? { receipt_for_message_id: a['message-id'] }
                        : {
                              compose_hint:
                                  'Use mail.+lint-html to preview rich HTML.',
                          }),
                    ...(a['show-lint-details']
                        ? {
                              lint_applied: s.result.lint_applied,
                              original_blocked: s.result.original_blocked,
                          }
                        : {}),
                },
            };
        },
    };
}

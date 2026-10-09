import { authorize } from '../../domain/authorization';
import type { RemoteFiles } from '../../ports/remote-files';
import { mailResourceStep } from './resources';
import { mailUploadStep } from './upload';
import { ServiceError } from '../../domain/errors';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
import type { MailTransformer } from '../../ports/mail';
import type { WorkflowProgram } from '../../ports/workflows';
import { invalid, mailbox, path, required, type Data } from './common';
import type { LarkTransferClient } from '../../ports/lark';
import { partitionMailMIME } from './partition';
import { extractRawMailStream } from './raw-stream';
import { mailPartPlaceholder, streamMailSkeletonJSON } from './stream';
import { localMailImages } from './images';
import { artifactPart } from './compose';
import { renderSignature } from './delivery';
import { readMailText } from './files';
export function draftPlan(
    args: Data,
    context?: Pick<CommandContext, 'selection'>,
): Data {
    if (args['print-patch-template']) return { mode: 'patch-template' };
    const mb = mailbox(args, context, true),
        id = required(args['draft-id'], 'draft-id');
    if (args.body && args['body-file'])
        invalid('body and body-file are mutually exclusive.');
    if (
        args['set-priority'] &&
        !['high', 'normal', 'low'].includes(args['set-priority'])
    )
        invalid('Invalid priority.');
    const event = [
        'set-event-summary',
        'set-event-start',
        'set-event-end',
        'set-event-location',
    ].some((k) => args[k]);
    if (args['remove-event'] && event)
        invalid('Cannot set and remove an event together.');
    if (
        !args.inspect &&
        !args['patch-file'] &&
        !args['request-receipt'] &&
        !Object.keys(args).some(
            (k) =>
                (k.startsWith('set-') ||
                    ['body', 'body-file', 'remove-event'].includes(k)) &&
                args[k],
        )
    )
        invalid('At least one edit operation is required.');
    return {
        mailbox: mb,
        id,
        requests: [
            {
                method: 'GET',
                path: path(mb, 'drafts', id),
                query: { format: 'raw' },
            },
            ...(!args.inspect
                ? [
                      {
                          method: 'PUT',
                          path: path(mb, 'drafts', id),
                          body: { raw: '<modified MIME>' },
                      },
                  ]
                : []),
        ],
    };
}
async function patchFromArgs(
    a: Data,
    context: CommandContext,
    artifacts: ArtifactFiles | undefined,
    pure: MailTransformer,
): Promise<Data> {
    let patch: Data = { ops: [], options: {} };
    if (a['patch-file']) {
        const text = await readMailText(
            String(a['patch-file']),
            context,
            artifacts,
        );
        try {
            patch = JSON.parse(text);
        } catch {
            invalid('Invalid patch JSON.');
        }
        if (
            !patch ||
            !Array.isArray(patch.ops) ||
            Object.keys(patch).some((k) => !['ops', 'options'].includes(k))
        )
            invalid('Expected typed patch ops and options.');
    }
    patch = { ...patch, ops: [...patch.ops], options: { ...patch.options } };
    if (String(a['set-subject'] ?? '').trim())
        patch.ops.push({ op: 'set_subject', value: a['set-subject'].trim() });
    for (const field of ['to', 'cc', 'bcc'])
        if (a[`set-${field}`])
            patch.ops.push({
                op: 'set_recipients',
                field,
                addresses: await pure.processMail({
                    operation: 'addresses',
                    addresses: a[`set-${field}`],
                }),
            });
    const body = a['body-file']
        ? await readMailText(
              String(a['body-file']),
              context,
              artifacts,
              8 << 20,
          )
        : a.body;
    if (body) {
        if (
            patch.ops.some((op: Data) =>
                ['set_body', 'set_reply_body'].includes(op.op),
            )
        )
            invalid('Direct body flags conflict with patch body operations.');
        patch.ops.push({ op: 'set_body', value: body });
    }
    if (a['set-priority'])
        patch.ops.push(
            a['set-priority'] === 'normal'
                ? { op: 'remove_header', name: 'X-Cli-Priority' }
                : {
                      op: 'set_header',
                      name: 'X-Cli-Priority',
                      value: a['set-priority'] === 'high' ? '1' : '5',
                  },
        );
    if (a['remove-event']) patch.ops.push({ op: 'remove_calendar' });
    if (
        [
            'set-event-summary',
            'set-event-start',
            'set-event-end',
            'set-event-location',
        ].some((k) => a[k])
    )
        patch.ops.push({
            op: 'set_calendar',
            event_summary: a['set-event-summary'] ?? '',
            event_start: a['set-event-start'] ?? '',
            event_end: a['set-event-end'] ?? '',
            event_location: a['set-event-location'] ?? '',
        });
    if (patch.ops.length)
        await pure.processMail({ operation: 'validate-patch', patch });
    return patch;
}
export function draftProgram(
    artifacts?: ArtifactFiles,
    pure?: MailTransformer,
    remote?: RemoteFiles,
): WorkflowProgram {
    return {
        id: 'mail-draft-edit',
        version: 1,
        domain: 'mail',
        risk: 'write',
        identities: ['user'],
        step: async (input, context) => {
            const s: Data = input,
                a = s.args,
                client = context.lark as typeof context.lark &
                    Partial<LarkTransferClient>;
            if (!pure) invalid('Mail transformations are unavailable.');
            if (s.phase === 'start') {
                const plan = draftPlan(a, context);
                if (plan.mode === 'patch-template')
                    return {
                        done: true,
                        output: (await pure.processMail({
                            operation: 'patch-template',
                        })) as Data,
                    };
                const patch = a.inspect
                    ? { ops: [] }
                    : await patchFromArgs(a, context, artifacts, pure);
                return {
                    done: false,
                    state: { ...s, ...plan, patch, phase: 'get' },
                };
            }
            if (s.phase === 'get') {
                let raw: string,
                    retainedParts: Data[] = [],
                    baseAdjustment = 0;
                if (client.download && artifacts?.ingest) {
                    const extracted = extractRawMailStream(
                            await client.download(s.requests[0]),
                        ),
                        partition = await partitionMailMIME(
                            extracted.body,
                            context,
                            artifacts,
                        );
                    await extracted.metadata;
                    raw = partition.raw;
                    retainedParts = partition.parts;
                    baseAdjustment = partition.baseAdjustment;
                } else {
                    const data: Data = await context.lark.request(
                        s.requests[0],
                    );
                    raw = data.raw || data.draft?.raw;
                }
                if (!raw)
                    throw new ServiceError(
                        'INVALID_UPSTREAM_RESPONSE',
                        'Draft response has no raw MIME.',
                    );
                const inspected = (await pure.processMail({
                    operation: 'inspect-eml',
                    raw,
                    draft_id: s.id,
                })) as Data;
                inspected.base_size =
                    Number(inspected.base_size || 0) + baseAdjustment;
                delete inspected.raw;
                if (a.inspect)
                    return {
                        done: true,
                        output: {
                            draft_id: s.id,
                            projection: inspected.projection,
                        },
                    };
                let rawState: Data = { raw };
                if (artifacts) {
                    const blob = new Blob([raw], { type: 'text/plain' }),
                        file = await artifacts.upload(
                            context.grant.id,
                            blob.size,
                            blob.stream(),
                        );
                    rawState = { rawArtifact: file.id };
                }
                return {
                    done: false,
                    state: {
                        ...s,
                        ...rawState,
                        retainedParts,
                        inspected,
                        phase: s.patch.ops.some(
                            (op: Data) => op.op === 'insert_signature',
                        )
                            ? 'signatures'
                            : 'apply',
                    },
                };
            }
            if (s.phase === 'signatures') {
                const signatures = await context.lark.request({
                    method: 'GET',
                    path: path(s.mailbox, 'settings', 'signatures'),
                });
                return {
                    done: false,
                    state: { ...s, signatures, phase: 'apply' },
                };
            }
            if (s.phase === 'signature-images') {
                if (!artifacts || !remote)
                    invalid(
                        'Signature image download services are unavailable.',
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
                        signatureFiles: result.files,
                        imagesComplete: true,
                        phase: 'apply',
                    },
                };
            }
            if (!s.imagesComplete && s.signatures) {
                const items: Data[] = [];
                for (const op of s.patch.ops) {
                    if (op.op !== 'insert_signature') continue;
                    const signature = (s.signatures.signatures ?? []).find(
                        (sig: Data) => sig.id === op.signature_id,
                    );
                    for (const image of signature?.images ?? [])
                        if (
                            image.download_url &&
                            image.cid &&
                            !items.some((v) => v.cid === image.cid)
                        )
                            items.push({
                                source: 'signature',
                                url: image.download_url,
                                cid: image.cid,
                                name: image.image_name,
                            });
                }
                if (items.length)
                    return {
                        done: false,
                        state: {
                            ...s,
                            phase: 'signature-images',
                            resourceState: {
                                phase: 'download',
                                items,
                                index: 0,
                                files: [],
                            },
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
                        phase: 'upload-large',
                        openId: data.open_id,
                        uploadIndex: 0,
                        uploaded: [],
                    },
                };
            }
            if (s.phase === 'upload-large') {
                if (!artifacts) invalid('Artifact storage is unavailable.');
                const file = s.largeFiles[s.uploadIndex],
                    result = await mailUploadStep(
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
                const index = s.uploadIndex + 1;
                return {
                    done: false,
                    state: {
                        ...s,
                        phase:
                            index < s.largeFiles.length
                                ? 'upload-large'
                                : 'apply',
                        uploadIndex: index,
                        uploadState: null,
                        uploaded: [
                            ...s.uploaded,
                            {
                                name: file.name,
                                size: file.size,
                                token: result.file_token,
                            },
                        ],
                        uploadsComplete: index === s.largeFiles.length,
                    },
                };
            }
            if (
                !s.uploadsComplete &&
                s.patch.ops.some((op: Data) => op.op === 'add_attachment')
            ) {
                if (!artifacts) invalid('Artifact storage is unavailable.');
                authorize(
                    context.grant,
                    { ...context.selection, domain: 'artifact', risk: 'read' },
                    Date.now(),
                );
                let budget = Number(s.inspected.base_size) || 2048;
                const large: Data[] = [],
                    remaining: Data[] = [];
                for (const op of s.patch.ops) {
                    if (op.op !== 'add_attachment') {
                        remaining.push(op);
                        continue;
                    }
                    const id = required(op.path, 'path').replace(/^@/, ''),
                        meta = await artifacts.stat(context.grant.id, id),
                        cost = Math.floor((meta.size * 4 + 2) / 3) + 200;
                    if (large.length || budget + cost > 25 * 1024 * 1024)
                        large.push({
                            id,
                            name: op.filename || id.split('/').pop(),
                            size: meta.size,
                        });
                    else {
                        remaining.push(op);
                        budget += cost;
                    }
                }
                if (large.length)
                    return {
                        done: false,
                        state: {
                            ...s,
                            patch: { ...s.patch, ops: remaining },
                            largeFiles: large,
                            phase: 'upload-owner',
                        },
                    };
            }
            const raw =
                    s.rawArtifact && artifacts
                        ? await (
                              await artifacts.read(
                                  context.grant.id,
                                  s.rawArtifact,
                              )
                          ).text()
                        : s.raw,
                patch: Data = {
                    ...s.patch,
                    ops: s.patch.ops.map((op: Data) => ({ ...op })),
                },
                files: Data = {},
                calendar: Data = {},
                signatures: Data = {},
                signatureImages: Data = {},
                slots = [...(s.retainedParts ?? [])],
                applied: Data[] = [],
                blocked: Data[] = [];
            if (a['request-receipt']) {
                const sender = s.inspected.from?.[0]?.address;
                if (!sender || /[\r\n]/.test(sender))
                    invalid('Draft sender is missing or invalid.');
                patch.ops.push({
                    op: 'set_header',
                    name: 'Disposition-Notification-To',
                    value: sender,
                });
            }
            for (const [index, op] of patch.ops.entries()) {
                if (
                    ['set_body', 'set_reply_body'].includes(op.op) &&
                    op.value
                ) {
                    const lint = (await pure.processMail({
                        operation: 'lint',
                        body: op.value,
                    })) as Data;
                    const images = localMailImages(lint.cleaned_html);
                    op.value = images.html;
                    for (const file of images.files)
                        patch.ops.push({
                            op: 'add_inline',
                            path: file.id,
                            cid: file.cid,
                            filename: file.name,
                        });
                    applied.push(...(lint.lint_applied ?? []));
                    blocked.push(...(lint.original_blocked ?? []));
                }
                if (
                    ['add_attachment', 'add_inline', 'replace_inline'].includes(
                        op.op,
                    )
                ) {
                    const file = {
                        id: required(op.path, 'path').replace(/^@/, ''),
                        name: op.filename || op.path.split('/').pop(),
                        ...(op.cid ? { cid: op.cid } : {}),
                    };
                    if (op.filename) {
                        if (/[\r\n\0\\/]/.test(op.filename))
                            invalid(
                                'Attachment filename must not contain path separators or line breaks.',
                            );
                        if (op.op === 'add_attachment')
                            op.path = `mail-artifact-${index}/${op.filename}`;
                    }
                    if (client.requestStream && artifacts) {
                        const placeholder = await mailPartPlaceholder(
                            file,
                            op.op === 'add_attachment'
                                ? 'attachment'
                                : 'inline',
                            context,
                            artifacts,
                        );
                        slots.push(placeholder.slot);
                        files[op.path] = placeholder.part.data;
                    } else {
                        const part = await artifactPart(
                            file,
                            context,
                            artifacts,
                        );
                        files[op.path] = part.data;
                    }
                }
                if (op.op === 'insert_signature') {
                    const signature = (s.signatures?.signatures ?? []).find(
                        (sig: Data) => sig.id === op.signature_id,
                    );
                    if (!signature) invalid('Signature not found.');
                    signatureImages[index] = [];
                    for (const image of signature.images ?? []) {
                        const file = (s.signatureFiles ?? []).find(
                            (f: Data) => f.cid === image.cid,
                        );
                        if (file) {
                            if (client.requestStream && artifacts) {
                                const placeholder = await mailPartPlaceholder(
                                    file,
                                    'inline',
                                    context,
                                    artifacts,
                                );
                                slots.push(placeholder.slot);
                                signatureImages[index].push(placeholder.part);
                            } else
                                signatureImages[index].push(
                                    await artifactPart(
                                        file,
                                        context,
                                        artifacts,
                                    ),
                                );
                        }
                    }
                    signatures[index] = renderSignature(
                        signature,
                        '',
                        s.inspected.from?.[0]?.address || '',
                    );
                }
            }
            const result = (await pure.processMail({
                operation: 'edit-eml',
                raw,
                draft_id: s.id,
                patch,
                files,
                large: s.uploaded ?? [],
                brand: context.lark.brand ?? 'feishu',
                calendar_by_op: calendar,
                signature_by_op: signatures,
                signature_images_by_op: signatureImages,
            })) as Data;
            const data: Data =
                client.requestStream && artifacts
                    ? await client.requestStream({
                          method: 'PUT',
                          path: path(s.mailbox, 'drafts', s.id),
                          body: streamMailSkeletonJSON(
                              result.raw,
                              slots,
                              context,
                              artifacts,
                          ),
                      })
                    : await context.lark.request({
                          method: 'PUT',
                          path: path(s.mailbox, 'drafts', s.id),
                          body: { raw: result.raw },
                      });
            if (s.rawArtifact && artifacts)
                await artifacts
                    .remove(context.grant.id, s.rawArtifact)
                    .catch(() => undefined);
            return {
                done: true,
                output: {
                    draft_id: data.draft_id || data.draft?.draft_id || s.id,
                    ...(data.reference || data.draft?.reference
                        ? { reference: data.reference || data.draft.reference }
                        : {}),
                    projection: result.projection,
                    warning:
                        'This edit flow has no optimistic locking. Concurrent updates use the last write.',
                    ...(a['show-lint-details']
                        ? { lint_applied: applied, original_blocked: blocked }
                        : {}),
                    compose_hint: 'Use mail.+lint-html to preview rich HTML.',
                },
            };
        },
    };
}

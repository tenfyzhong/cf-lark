import { ServiceError } from '../../domain/errors';
import type { CommandContext } from '../../ports/capabilities';
import type { WorkflowProgram } from '../../ports/workflows';
import { invalid, list, mailbox, path, required, type Data } from './common';
export function renderSignature(
    signature: Data,
    senderName = '',
    senderEmail = '',
): string {
    if (!signature.template_json_keys?.length) return signature.content ?? '';
    const values: Data = Object.fromEntries(
        Object.entries(signature.user_fields ?? {}).map(([key, value]) => [
            key,
            (value as Data).i18n_vals?.en_us ||
                (value as Data).default_val ||
                '',
        ]),
    );
    if (senderName) values['B-NAME'] = senderName;
    if (senderEmail) values['B-ENTERPRISE-EMAIL'] = senderEmail;
    const escape = (v: string) =>
        v
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    return String(signature.content ?? '').replace(
        /<span\s+data-variable-meta-props=(?:"([^"]*?)"|'([^']*?)')>([\s\S]*?)<\/span>/g,
        (original, double: string, single: string) => {
            let meta: Data;
            try {
                meta = JSON.parse(
                    (double || single)
                        .replace(/&quot;/g, '"')
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>'),
                );
            } catch {
                return original;
            }
            const value = values[meta.id] ?? '';
            if (!value) return '';
            if (meta.type === 'image')
                return `<img src="${escape(value)}"${meta.width ? ` width="${escape(meta.width)}"` : ''}${meta.style || meta.circle ? ` style="${escape([meta.style, meta.circle ? 'border-radius: 100%' : ''].filter(Boolean).join(';'))}"` : ''}>`;
            if (meta.type === 'text') {
                if (/^https?:\/\//.test(value.trim()))
                    return `<a href="${escape(value)}" target="_blank" rel="noopener noreferrer">${escape(value)}</a>`;
                return meta.style
                    ? `<span style="${escape(meta.style)}">${escape(value)}</span>`
                    : escape(value);
            }
            return value;
        },
    );
}
export function signatureOutput(data: Data, detail?: string): Data {
    const signatures = data.signatures ?? [];
    const convert = (signature: Data): Data => {
        const text = renderSignature(signature)
                .replace(/<img[^>]*>/g, '[image]')
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim(),
            chars = [...text];
        const out: Data = {
            id: signature.id,
            name: signature.name,
            type: signature.signature_type,
            content_preview:
                chars.length > 200
                    ? chars.slice(0, 200).join('') + '...'
                    : text,
        };
        if (signature.images?.length)
            out.images = detail ? signature.images : signature.images.length;
        if (
            (data.usages ?? []).some(
                (u: Data) =>
                    u.send_mail_signature_id === signature.id &&
                    signature.id !== '0' &&
                    signature.id !== '',
            )
        )
            out.is_send_default = true;
        if (
            (data.usages ?? []).some(
                (u: Data) =>
                    u.reply_signature_id === signature.id &&
                    signature.id !== '0' &&
                    signature.id !== '',
            )
        )
            out.is_reply_default = true;
        if (detail && signature.template_json_keys?.length)
            out.template_vars = Object.fromEntries(
                Object.entries(signature.user_fields ?? {}).map(
                    ([key, field]) => [
                        key,
                        (field as Data).i18n_vals?.en_us ||
                            (field as Data).default_val ||
                            '',
                    ],
                ),
            );
        return out;
    };
    if (detail) {
        const signature = signatures.find((s: Data) => s.id === detail);
        if (!signature) invalid('Signature not found.');
        return convert(signature);
    }
    return { signatures: signatures.map(convert) };
}
export function deliveryPlan(
    action: string,
    args: Data,
    context?: Pick<CommandContext, 'selection'>,
): Data {
    const mb = mailbox(args, context, true);
    if (action === 'signature')
        return {
            requests: [
                {
                    method: 'GET',
                    path: path(args.from || 'me', 'settings', 'signatures'),
                },
            ],
        };
    if (action === 'share-to-chat') {
        if (!!args['message-id'] === !!args['thread-id'])
            invalid('Provide exactly one message-id or thread-id.');
        const kind = args['thread-id'] ? 'thread_id' : 'message_id',
            target = required(
                args['thread-id'] || args['message-id'],
                'mail resource ID',
            ),
            receiver = required(args['receive-id'], 'receive-id'),
            type = args['receive-id-type'] || 'chat_id';
        if (
            !['chat_id', 'open_id', 'user_id', 'union_id', 'email'].includes(
                type,
            )
        )
            invalid('Invalid receive-id-type.');
        return {
            mailbox: mb,
            receiver,
            type,
            requests: [
                {
                    method: 'POST',
                    path: path(mb, 'messages', 'share_token'),
                    body: { [kind]: target },
                },
                {
                    method: 'POST',
                    path: path(mb, 'share_tokens', '<card_id>', 'send'),
                    query: { receive_id_type: type },
                    body: { receive_id: receiver },
                },
            ],
        };
    }
    const ids = list(args['draft-id']).map((value) => value.trim());
    if (
        !ids.length ||
        ids.length > 50 ||
        ids.some((v) => !v) ||
        new Set(ids).size !== ids.length
    )
        invalid('Provide 1 to 50 unique nonempty draft IDs.');
    return {
        mailbox: mb,
        ids,
        requests: ids.map((id) => ({
            method: 'POST',
            path: path(mb, 'drafts', id, 'send'),
        })),
    };
}
export function deliveryProgram(): WorkflowProgram {
    return {
        id: 'mail-delivery',
        version: 1,
        domain: 'mail',
        risk: 'write',
        identities: ['user'],
        step: async (input, context) => {
            const state: Data = input;
            if (state.phase === 'start')
                return {
                    done: false,
                    state: {
                        ...state,
                        ...deliveryPlan(state.action, state.args, context),
                        phase: 'run',
                        index: 0,
                        sent: [],
                        failed: [],
                    },
                };
            if (state.action === 'share-to-chat') {
                if (!state.card) {
                    const data = await context.lark.request(state.requests[0]);
                    if (!data.card_id)
                        throw new ServiceError(
                            'INVALID_UPSTREAM_RESPONSE',
                            'Share response has no card_id.',
                        );
                    return {
                        done: false,
                        state: { ...state, card: data.card_id },
                    };
                }
                const data = await context.lark.request({
                    ...state.requests[1],
                    path: path(
                        state.mailbox,
                        'share_tokens',
                        state.card,
                        'send',
                    ),
                });
                return {
                    done: true,
                    output: {
                        card_id: state.card,
                        im_message_id: data.message_id,
                    },
                };
            }
            if (state.index >= state.ids.length || state.stopped)
                return {
                    done: true,
                    output: {
                        mailbox_id: state.mailbox,
                        total: state.ids.length,
                        success_count: state.sent.length,
                        failure_count: state.failed.length,
                        sent: state.sent,
                        ...(state.failed.length
                            ? { failed: state.failed, ok: false }
                            : {}),
                        ...(state.aborted
                            ? { aborted: true, abort_error: state.abort_error }
                            : {}),
                    },
                };
            try {
                const data = await context.lark.request(
                    state.requests[state.index],
                );
                if (Object.hasOwn(data, 'automation_send_disable'))
                    throw new ServiceError(
                        'AUTOMATION_SEND_DISABLED',
                        'Automation send is disabled for this mailbox.',
                    );
                return {
                    done: false,
                    state: {
                        ...state,
                        index: state.index + 1,
                        sent: [
                            ...state.sent,
                            {
                                draft_id: state.ids[state.index],
                                message_id: data.message_id ?? '',
                                ...(data.thread_id
                                    ? { thread_id: data.thread_id }
                                    : {}),
                            },
                        ],
                    },
                };
            } catch (error) {
                if (
                    !(error instanceof ServiceError) ||
                    error.code === 'OUTCOME_UNCERTAIN'
                )
                    throw error;
                const upstream = Number(error.details?.upstreamCode),
                    fatal =
                        error.code !== 'UPSTREAM_ERROR' ||
                        [
                            1234013, 1236007, 1236008, 1236009, 1236010,
                            1236013, 99991663, 99991668, 99991669, 99991400,
                            99991401,
                        ].includes(upstream);
                if (fatal && !state.sent.length && !state.failed.length)
                    throw error;
                return {
                    done: false,
                    state: {
                        ...state,
                        index: state.index + 1,
                        failed: [
                            ...state.failed,
                            {
                                draft_id: state.ids[state.index],
                                error: error.message,
                            },
                        ],
                        stopped: fatal || state.args['stop-on-error'] === true,
                        ...(fatal
                            ? {
                                  aborted: true,
                                  abort_error: {
                                      code: error.code,
                                      message: error.message,
                                  },
                              }
                            : {}),
                    },
                };
            }
        },
    };
}

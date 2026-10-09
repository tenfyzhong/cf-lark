import { ServiceError } from '../../domain/errors';
import type { CommandContext } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram } from '../../ports/workflows';
import {
    chunks,
    invalid,
    list,
    mailbox,
    path,
    required,
    type Data,
} from './common';
const labels = [
    'UNREAD',
    'IMPORTANT',
    'OTHER',
    'FLAGGED',
    'READ_RECEIPT_REQUEST',
];
const folders: Record<string, string> = {
    INBOX: 'INBOX',
    SENT: 'SENT',
    SPAM: 'SPAM',
    ARCHIVE: 'ARCHIVED',
    ARCHIVED: 'ARCHIVED',
};
function ids(value: unknown, thread: boolean): string[] {
    const values = list(value);
    if (!values.length) invalid('Resource IDs are required.');
    for (const value of values)
        if (
            !/^[A-Za-z0-9+/=_-]+$/.test(value) ||
            /^\d+$/.test(value) ||
            (!thread && value.length < 16)
        )
            invalid(
                'Use OpenAPI resource IDs without whitespace, not numeric primary IDs.',
            );
    return [...new Set(values)];
}
function normalizeLabels(value: unknown, thread: boolean): string[] {
    const values = list(value).map((value) => {
        if (!value || value.trim() !== value)
            invalid('Label IDs cannot be blank or padded with whitespace.');
        const upper = value.toUpperCase();
        if (thread && upper === 'READ_RECEIPT_REQUEST')
            invalid('Read receipt labels are message-only.');
        return labels.includes(upper) ? upper : value;
    });
    const result = [...new Set(values)];
    if (result.length > 20) invalid('At most 20 label IDs are allowed.');
    return result;
}
export function managePlan(
    action: string,
    args: Data,
    context?: Pick<CommandContext, 'selection'>,
): Data {
    const mb = mailbox(args, context),
        thread = action.startsWith('thread-'),
        kind = thread ? 'thread' : 'message';
    if (action === 'decline-receipt') {
        const target = required(args['message-id'], 'message-id');
        return {
            requests: [
                {
                    method: 'GET',
                    path: path(mb, 'messages', target),
                    query: { format: 'plain_text_full' },
                },
            ],
            target,
        };
    }
    const values = ids(args[`${kind}-ids`], thread),
        requests: ApiRequest[] = [],
        validation: ApiRequest[] = [];
    const trash = action.endsWith('trash');
    const add = trash ? [] : normalizeLabels(args['add-label-ids'], thread),
        remove = trash ? [] : normalizeLabels(args['remove-label-ids'], thread);
    if (add.some((item) => remove.includes(item)))
        invalid('A label cannot be added and removed together.');
    if (
        args['folder-id'] &&
        args['add-folder'] &&
        args['folder-id'] !== args['add-folder']
    )
        invalid('folder-id and add-folder disagree.');
    const raw = trash
        ? ''
        : String(args['add-folder'] ?? args['folder-id'] ?? '');
    if (raw && (!raw.trim() || (!thread && raw !== raw.trim())))
        invalid('Folder must not contain surrounding whitespace.');
    if (raw.trim().toUpperCase() === 'TRASH')
        invalid('Use the trash shortcut to move resources to trash.');
    const folder = folders[raw.trim().toUpperCase()] ?? raw.trim();
    if (!thread) {
        for (const label of new Set(
            [...add, ...remove].filter((item) => !labels.includes(item)),
        ))
            validation.push({ method: 'GET', path: path(mb, 'labels', label) });
        if (folder && !Object.values(folders).includes(folder))
            validation.push({
                method: 'GET',
                path: path(mb, 'folders', folder),
            });
    }
    if (!trash && !add.length && !remove.length && !folder) {
        if (thread) invalid('Provide a label or folder change.');
        return { requests: [], validation, ids: values, kind };
    }
    for (const batch of chunks(values, 20))
        requests.push({
            method: 'POST',
            path: path(mb, `${kind}s`, trash ? 'batch_trash' : 'batch_modify'),
            body: {
                [`${kind}_ids`]: batch,
                ...(add.length ? { add_label_ids: add } : {}),
                ...(remove.length ? { remove_label_ids: remove } : {}),
                ...(folder ? { add_folder: folder } : {}),
            },
        });
    return { requests, validation, ids: values, kind };
}
export function manageProgram(): WorkflowProgram {
    return {
        id: 'mail-manage',
        version: 1,
        domain: 'mail',
        risk: 'write',
        identities: ['user', 'bot'],
        step: async (input, context) => {
            const state: Data = input;
            if (state.phase === 'start') {
                const plan = managePlan(state.action, state.args, context);
                return {
                    done: false,
                    state: {
                        ...state,
                        ...plan,
                        phase: 'validate',
                        index: 0,
                        success: [],
                        failed: [],
                    },
                };
            }
            if (state.action === 'decline-receipt') {
                if (state.phase === 'validate') {
                    const data: Data = await context.lark.request(
                        state.requests[0],
                    );
                    const message = data.message ?? data;
                    if (
                        !(message.label_ids ?? []).some(
                            (label: string) =>
                                label === 'READ_RECEIPT_REQUEST' ||
                                label === '-607',
                        )
                    )
                        return {
                            done: true,
                            output: {
                                message_id: state.target,
                                decline_receipt_for_id: state.target,
                                declined: false,
                                already_cleared: true,
                            },
                        };
                    return {
                        done: false,
                        state: { ...state, phase: 'decline' },
                    };
                }
                await context.lark.request({
                    method: 'PUT',
                    path: `${state.requests[0].path}/modify`,
                    body: { remove_label_ids: ['READ_RECEIPT_REQUEST'] },
                });
                return {
                    done: true,
                    output: {
                        message_id: state.target,
                        decline_receipt_for_id: state.target,
                        declined: true,
                    },
                };
            }
            if (state.phase === 'validate') {
                if (state.index < state.validation.length) {
                    await context.lark.request(state.validation[state.index]);
                    return {
                        done: false,
                        state: { ...state, index: state.index + 1 },
                    };
                }
                return {
                    done: false,
                    state: {
                        ...state,
                        phase: 'mutate',
                        index: 0,
                        success: state.requests.length ? [] : state.ids,
                    },
                };
            }
            if (state.index >= state.requests.length)
                return {
                    done: true,
                    output: {
                        [`success_${state.kind}_ids`]: state.success,
                        [`failed_${state.kind}_ids`]: state.failed,
                        ...(!state.success.length && state.failed.length
                            ? { ok: false }
                            : {}),
                    },
                };
            const request = state.requests[state.index],
                batch = request.body[`${state.kind}_ids`];
            try {
                await context.lark.request(request);
                return {
                    done: false,
                    state: {
                        ...state,
                        index: state.index + 1,
                        success: [...state.success, ...batch],
                    },
                };
            } catch (error) {
                if (
                    !(error instanceof ServiceError) ||
                    error.code === 'OUTCOME_UNCERTAIN'
                )
                    throw error;
                return {
                    done: false,
                    state: {
                        ...state,
                        index: state.index + 1,
                        failed: [
                            ...state.failed,
                            ...batch.map((id: string) => ({
                                [`${state.kind}_id`]: id,
                                reason: error.message,
                            })),
                        ],
                    },
                };
            }
        },
    };
}

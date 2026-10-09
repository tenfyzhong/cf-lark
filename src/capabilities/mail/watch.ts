import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import { publicEventPayload } from '../../domain/event-payload';
import type { ArtifactStore } from '../../ports/artifacts';
import type { EventInbox } from '../../ports/events';
import type { WorkflowProgram } from '../../ports/workflows';
import { invalid, path, type Data } from './common';
import { folderAliases, labelAliases, resolveLookup } from './triage';
import { decode } from './read';
const eventType = 'mail.user_mailbox.event.message_received_v1';
function array(value: unknown): string[] {
    let parsed = value ?? [];
    if (typeof parsed === 'string') {
        try {
            parsed = parsed.trim() ? JSON.parse(parsed) : [];
        } catch {
            invalid('Watch filters must be JSON string arrays.');
        }
    }
    if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== 'string'))
        invalid('Watch filters must be string arrays.');
    return [...new Set(parsed.map((v) => v.trim()).filter(Boolean))];
}
export function watchPlan(args: Data): Data {
    const cursor = Number(args.cursor ?? 0),
        limit = Number(args.limit ?? 50),
        mode = args['msg-format'] || 'metadata',
        format = args.format || 'data';
    if (
        !Number.isSafeInteger(cursor) ||
        cursor < 0 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
    )
        invalid('cursor must be nonnegative and limit must be 1 to 100.');
    if (!['json', 'data'].includes(format))
        invalid('format must be json or data.');
    const directory = String(args['output-dir'] ?? '');
    if (
        directory &&
        (/^[~\\/]/.test(directory) ||
            directory.split(/[\\/]/).includes('..') ||
            /[\x00-\x1f]/.test(directory))
    )
        invalid(
            'output-dir must be a relative logical directory without traversal.',
        );
    const lookups: Data[] = [],
        labels: string[] = [],
        folders: string[] = [];
    for (const kind of ['label', 'folder']) {
        const aliases = kind === 'label' ? labelAliases : folderAliases,
            target = kind === 'label' ? labels : folders;
        for (const value of array(args[`${kind}-ids`])) {
            const system = aliases[value.toLowerCase()];
            if (system) target.push(system);
            else lookups.push({ kind, value, explicit: true });
        }
        for (const value of array(args[`${kind}s`])) {
            const system = aliases[value.toLowerCase()];
            if (system) target.push(system);
            else lookups.push({ kind, value, explicit: false });
        }
    }
    return {
        cursor,
        limit,
        mode,
        format,
        directory,
        lookups,
        labels,
        folders,
        mailbox: args.mailbox || 'me',
        transport: 'verified-callback-inbox',
        event_type: eventType,
        requests:
            cursor === 0 || args.stop
                ? [
                      {
                          method: 'POST',
                          path: path(
                              args.mailbox || 'me',
                              'event',
                              args.stop ? 'unsubscribe' : 'subscribe',
                          ),
                          body: { event_type: 1 },
                      },
                  ]
                : [],
    };
}
export function watchProgram(
    inbox: Pick<EventInbox, 'read'>,
    artifacts?: ArtifactStore,
): WorkflowProgram {
    return {
        id: 'mail-watch',
        version: 1,
        domain: 'mail',
        risk: 'read',
        identities: ['user'],
        step: async (input, context) => {
            const s: Data = input;
            if (s.phase === 'start') {
                const plan = watchPlan(s.args);
                if (s.args['print-output-schema'])
                    return {
                        done: true,
                        output: {
                            type: 'object',
                            properties: {
                                events: { type: 'array' },
                                cursor: { type: 'integer' },
                            },
                            transport: plan.transport,
                        },
                    };
                if (plan.directory) {
                    if (!artifacts) invalid('Artifact storage is unavailable.');
                    authorize(
                        context.grant,
                        {
                            ...context.selection,
                            domain: 'artifact',
                            risk: 'write',
                        },
                        Date.now(),
                    );
                }
                return {
                    done: false,
                    state: {
                        ...s,
                        ...plan,
                        phase: s.args.stop ? 'resolve' : 'identity',
                        index: 0,
                        events: [],
                    },
                };
            }
            if (s.phase === 'identity') {
                const profile = await context.lark.request({
                        method: 'GET',
                        path: path(s.mailbox, 'profile'),
                    }),
                    email = String(profile.primary_email_address ?? '')
                        .trim()
                        .toLowerCase();
                if (!email) invalid('Unable to verify the watched mailbox.');
                return {
                    done: false,
                    state: { ...s, eventMailbox: email, phase: 'resolve' },
                };
            }
            if (s.phase === 'resolve') {
                if (s.index < s.lookups.length) {
                    const lookup = s.lookups[s.index],
                        data = await context.lark.request({
                            method: 'GET',
                            path: path(s.mailbox, `${lookup.kind}s`),
                        }),
                        id = resolveLookup(
                            (data.items ?? []) as Data[],
                            lookup.value,
                            lookup.explicit,
                            false,
                        ),
                        key = `${lookup.kind}s`;
                    return {
                        done: false,
                        state: {
                            ...s,
                            index: s.index + 1,
                            [key]: [...s[key], id],
                        },
                    };
                }
                return { done: false, state: { ...s, phase: 'subscribe' } };
            }
            if (s.phase === 'subscribe') {
                if (s.requests.length)
                    await context.lark.request(s.requests[0]);
                if (s.args.stop)
                    return {
                        done: true,
                        output: { stopped: true, mailbox_id: s.mailbox },
                    };
                return { done: false, state: { ...s, phase: 'inbox' } };
            }
            if (s.phase === 'inbox') {
                const page = await inbox.read(
                    context.selection.profileId,
                    s.cursor,
                    s.limit,
                );
                return {
                    done: false,
                    state: {
                        ...s,
                        phase: 'messages',
                        pending: page.events
                            .filter((event) => event.type === eventType)
                            .map((event) => ({
                                ...event,
                                payload: publicEventPayload(event.payload),
                            })),
                        cursor: page.cursor,
                        index: 0,
                    },
                };
            }
            if (s.index >= s.pending.length)
                return {
                    done: true,
                    output: {
                        events: s.events,
                        cursor: s.cursor,
                        transport: 'verified-callback-inbox',
                        continuation:
                            'Poll again with this cursor. Set stop=true to unsubscribe.',
                    },
                };
            const event = s.pending[s.index],
                body = event.payload.event ?? event.payload,
                advance = (data?: Data) => ({
                    done: false as const,
                    state: {
                        ...s,
                        index: s.index + 1,
                        events: data
                            ? [
                                  ...s.events,
                                  {
                                      sequence: event.sequence,
                                      data:
                                          s.format === 'json'
                                              ? {
                                                    ok: true,
                                                    identity:
                                                        context.selection
                                                            .identity,
                                                    data,
                                                }
                                              : data,
                                  },
                              ]
                            : s.events,
                    },
                });
            if (
                !body.message_id ||
                String(body.mail_address ?? '').toLowerCase() !== s.eventMailbox
            )
                return advance();
            const fetch =
                s.mode !== 'event' ||
                s.labels.length ||
                s.folders.length ||
                s.directory;
            let message: Data | undefined;
            if (fetch) {
                const format = s.directory
                    ? 'full'
                    : ['full', 'plain_text_full', 'metadata'].includes(s.mode)
                      ? s.mode
                      : 'metadata';
                try {
                    const data = await context.lark.request({
                        method: 'GET',
                        path: path(
                            body.mail_address || s.mailbox,
                            'messages',
                            body.message_id,
                        ),
                        query: { format },
                    });
                    if (!data.message)
                        throw new ServiceError(
                            'INVALID_UPSTREAM_RESPONSE',
                            'Response has no message.',
                        );
                    message = data.message as Data;
                } catch (error) {
                    return advance({
                        ok: false,
                        error: {
                            type: 'fetch_message_failed',
                            message_id: body.message_id,
                            format,
                            message:
                                error instanceof Error
                                    ? error.message
                                    : 'Fetch failed.',
                        },
                        event: body,
                    });
                }
            }
            if (
                (s.folders.length && !s.folders.includes(message?.folder_id)) ||
                (s.labels.length &&
                    !(message?.label_ids ?? []).some((id: string) =>
                        s.labels.includes(id),
                    ))
            )
                return advance();
            let output: Data =
                s.mode === 'event'
                    ? event.payload
                    : {
                          message:
                              s.mode === 'minimal'
                                  ? Object.fromEntries(
                                        [
                                            'message_id',
                                            'thread_id',
                                            'folder_id',
                                            'label_ids',
                                            'internal_date',
                                            'message_state',
                                        ]
                                            .filter(
                                                (k) =>
                                                    message?.[k] !== undefined,
                                            )
                                            .map((k) => [k, message![k]]),
                                    )
                                  : message,
                      };
            if (s.directory && artifacts) {
                const full = { ...message };
                for (const key of ['body_html', 'body_plain_text'])
                    if (full[key]) full[key] = decode(full[key]);
                const blob = new Blob([JSON.stringify(full, null, 2) + '\n'], {
                        type: 'application/json',
                    }),
                    artifact = await artifacts.upload(
                        context.grant.id,
                        blob.size,
                        blob.stream(),
                    );
                output = {
                    ...output,
                    artifact: {
                        id: artifact.id,
                        directory: s.directory,
                        name: `${String(body.message_id).replace(/[^A-Za-z0-9_.-]/g, '_')}.json`,
                    },
                };
            }
            return advance(output);
        },
    };
}

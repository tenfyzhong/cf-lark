import type { CommandContext } from '../../ports/capabilities';
import type { WorkflowProgram } from '../../ports/workflows';
import { ServiceError } from '../../domain/errors';
import {
    chunks,
    invalid,
    list,
    mailbox,
    path,
    required,
    type Data,
} from './common';
export function decode(value: unknown): string {
    if (typeof value !== 'string' || !value) return '';
    try {
        return new TextDecoder().decode(
            Uint8Array.from(
                atob(value.replace(/-/g, '+').replace(/_/g, '/')),
                (c) => c.charCodeAt(0),
            ),
        );
    } catch {
        return value;
    }
}
function calendar(value: string): Data | undefined {
    const out: Data = {
        method: '',
        uid: '',
        summary: '',
        location: '',
        organizer: '',
        attendees: [],
    };
    let inside = false,
        found = false;
    for (const line of value.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
        const upper = line.toUpperCase();
        if (upper === 'BEGIN:VEVENT') {
            inside = true;
            continue;
        }
        if (upper === 'END:VEVENT') {
            inside = false;
            found = true;
            continue;
        }
        const match = line.match(/^((?:[^":]|"[^"]*")+):(.*)$/);
        if (!match) continue;
        const name = match[1]!,
            raw = match[2]!,
            key = name.split(';')[0]!.toUpperCase();
        if (!inside) {
            if (key === 'METHOD') out.method = raw.trim();
            continue;
        }
        if (['UID', 'SUMMARY', 'LOCATION'].includes(key))
            out[key.toLowerCase()] =
                key === 'UID'
                    ? raw
                    : raw.replace(/\\([nN\\;,])/g, (_, c: string) =>
                          /[nN]/.test(c) ? '\n' : c,
                      );
        if (key === 'ORGANIZER' || key === 'ATTENDEE') {
            const email = raw.replace(/^.*mailto:/i, '').trim();
            if (email.includes('@') && !/\s/.test(email)) {
                if (key === 'ORGANIZER') out.organizer = email;
                else out.attendees.push(email);
            }
        }
        if (key === 'DTSTART' || key === 'DTEND') {
            const m = raw.match(
                /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/,
            );
            if (!m) continue;
            let stamp = Date.UTC(
                +m[1]!,
                +m[2]! - 1,
                +m[3]!,
                +(m[4] ?? 0),
                +(m[5] ?? 0),
                +(m[6] ?? 0),
            );
            const timezone = name.match(/TZID=([^;]+)/i)?.[1];
            if (timezone && !m[7]) {
                try {
                    const formatter = new Intl.DateTimeFormat('en-US', {
                        timeZone: timezone,
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hourCycle: 'h23',
                    });
                    const parts = Object.fromEntries(
                        formatter
                            .formatToParts(stamp)
                            .map((p) => [p.type, p.value]),
                    );
                    const represented = Date.UTC(
                        +parts.year!,
                        +parts.month! - 1,
                        +parts.day!,
                        +parts.hour!,
                        +parts.minute!,
                        +parts.second!,
                    );
                    stamp -= represented - stamp;
                } catch {
                    /* Unknown zones use UTC, matching the CLI fallback. */
                }
            }
            out[key === 'DTSTART' ? 'start' : 'end'] = new Date(stamp)
                .toISOString()
                .replace('.000Z', 'Z');
        }
    }
    return found ? out : undefined;
}
const mime: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    pdf: 'application/pdf',
    txt: 'text/plain; charset=utf-8',
    html: 'text/html; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    json: 'application/json',
    zip: 'application/zip',
    ics: 'text/calendar; charset=utf-8',
};
export function messageOutput(message: Data, html: boolean): Data {
    const out: Data = Object.fromEntries(
        Object.entries(message).filter(
            ([key]) => !key.startsWith('body_') && key !== 'attachments',
        ),
    );
    if (message.draft_id || String(message.folder_id).toUpperCase() === 'DRAFT')
        out.draft_id = message.draft_id || message.message_id;
    const timestamp = Number(message.internal_date ?? 0);
    out.date_formatted = timestamp
        ? new Date(timestamp > 1e12 ? timestamp : timestamp * 1000)
              .toISOString()
              .replace('T', ' ')
              .slice(0, 19)
        : '';
    out.message_state_text =
        ({ 1: 'received', 2: 'sent', 3: 'draft' } as Data)[
            message.message_state
        ] ?? 'unknown';
    let priority = String(message.priority_type ?? '');
    for (const label of message.label_ids ?? []) {
        if (label === 'HIGH_PRIORITY') priority = '1';
        if (label === 'LOW_PRIORITY') priority = '5';
    }
    if (priority) {
        out.priority_type = priority;
        out.priority_type_text =
            ({ 1: 'high', 3: 'normal', 5: 'low' } as Data)[priority] ??
            'unknown';
    }
    out.body_preview = decode(message.body_preview);
    out.body_plain_text = (decode(message.body_plain_text) || out.body_preview)
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\r(?!\n)/g, '');
    if (html && message.body_html) out.body_html = decode(message.body_html);
    const event = calendar(decode(message.body_calendar));
    if (event) out.calendar_event = event;
    out.attachments = (message.attachments ?? [])
        .filter((a: unknown) => a && typeof a === 'object')
        .map((a: Data) => ({
            id: a.id ?? '',
            filename: a.filename ?? '',
            content_type:
                a.content_type ||
                mime[String(a.filename).split('.').pop()!.toLowerCase()] ||
                'application/octet-stream',
            attachment_type: Number(a.attachment_type ?? 0),
            is_inline: a.is_inline === true,
            cid: a.cid ?? '',
        }));
    return out;
}
export function readPlan(
    action: string,
    args: Data,
    context?: Pick<CommandContext, 'selection'>,
): Data {
    const mb = mailbox(args, context),
        format = args.html === false ? 'plain_text_full' : 'full';
    if (args['print-output-schema'])
        return {
            schema: {
                type: 'object',
                additionalProperties: true,
                properties: {
                    message_id: { type: 'string' },
                    body_plain_text: { type: 'string' },
                    body_html: { type: 'string' },
                    attachments: { type: 'array' },
                },
            },
        };
    if (action === 'messages') {
        const ids = list(args['message-ids']);
        if (!ids.length || new Set(ids).size !== ids.length)
            invalid('Provide unique message IDs.');
        for (const id of ids) {
            if (!/^[A-Za-z0-9_-]+={0,2}$/.test(id) || /^\d+$/.test(id))
                invalid('Expected base64url OpenAPI message IDs.');
            try {
                if (!atob(id.replace(/-/g, '+').replace(/_/g, '/')).length)
                    invalid('Invalid message ID.');
            } catch {
                invalid('Invalid base64url message ID.');
            }
        }
        return {
            ids,
            requests: chunks(ids, 20).map((batch) => ({
                method: 'POST',
                path: path(mb, 'messages', 'batch_get'),
                body: { message_ids: batch, format },
            })),
        };
    }
    const target = required(
        args[action === 'thread' ? 'thread-id' : 'message-id'],
        `${action}-id`,
    );
    return {
        requests: [
            {
                method: 'GET',
                path: path(
                    mb,
                    action === 'thread' ? 'threads' : 'messages',
                    target,
                ),
                query: {
                    format,
                    ...(action === 'thread' && args['include-spam-trash']
                        ? { include_spam_trash: true }
                        : {}),
                },
            },
        ],
        target,
    };
}
export function readProgram(): WorkflowProgram {
    return {
        id: 'mail-read',
        version: 1,
        domain: 'mail',
        risk: 'read',
        identities: ['user', 'bot'],
        step: async (input, context) => {
            const state: Data = input;
            if (state.phase === 'start') {
                const plan = readPlan(state.action, state.args, context);
                if (plan.schema) return { done: true, output: plan.schema };
                return {
                    done: false,
                    state: {
                        ...state,
                        ...plan,
                        phase: 'read',
                        index: 0,
                        messages: [],
                    },
                };
            }
            if (state.index < state.requests.length) {
                const data: Data = await context.lark.request(
                    state.requests[state.index],
                );
                let messages: Data[];
                if (state.action === 'message') {
                    if (!data.message)
                        throw new ServiceError(
                            'UPSTREAM_ERROR',
                            'Response has no message.',
                        );
                    messages = [data.message];
                } else if (state.action === 'thread')
                    messages = data.thread?.messages?.length
                        ? data.thread.messages
                        : (data.items ?? []).map(
                              (item: Data) => item.message ?? item,
                          );
                else messages = data.messages ?? [];
                return {
                    done: false,
                    state: {
                        ...state,
                        index: state.index + 1,
                        messages: [...state.messages, ...messages],
                    },
                };
            }
            if (state.action === 'message')
                return {
                    done: true,
                    output: messageOutput(
                        state.messages[0],
                        state.args.html !== false,
                    ),
                };
            if (state.action === 'thread') {
                const messages = [...state.messages]
                    .sort(
                        (a, b) =>
                            Number(a.internal_date ?? 0) -
                            Number(b.internal_date ?? 0),
                    )
                    .map((m) => messageOutput(m, state.args.html !== false));
                return {
                    done: true,
                    output: {
                        thread_id: state.target,
                        message_count: messages.length,
                        messages,
                    },
                };
            }
            const indexed = new Map<string, Data>(
                state.messages.map((m: Data) => [m.message_id, m]),
            );
            const missing = state.ids.filter((id: string) => !indexed.has(id));
            const messages = state.ids
                .filter((id: string) => indexed.has(id))
                .map((id: string) =>
                    messageOutput(indexed.get(id)!, state.args.html !== false),
                );
            return {
                done: true,
                output: {
                    messages,
                    total: messages.length,
                    ...(missing.length
                        ? { unavailable_message_ids: missing }
                        : {}),
                },
            };
        },
    };
}

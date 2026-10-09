import type { CommandContext } from '../../ports/capabilities';
import type { WorkflowProgram } from '../../ports/workflows';
import { chunks, invalid, mailbox, path, type Data } from './common';
import { decode, messageOutput } from './read';
export const folderAliases: Data = {
    inbox: 'INBOX',
    sent: 'SENT',
    draft: 'DRAFT',
    trash: 'TRASH',
    spam: 'SPAM',
    archive: 'ARCHIVED',
    archived: 'ARCHIVED',
};
export const labelAliases: Data = {
    important: 'IMPORTANT',
    priority: 'IMPORTANT',
    flagged: 'FLAGGED',
    other: 'OTHER',
    '\u91cd\u8981\u90ae\u4ef6': 'IMPORTANT',
    '\u5df2\u52a0\u65d7\u6807': 'FLAGGED',
    '\u5176\u4ed6\u90ae\u4ef6': 'OTHER',
};
const searchLabel: Data = {
    IMPORTANT: 'priority',
    FLAGGED: 'flagged',
    OTHER: 'other',
};
const filterKeys = [
    'folder',
    'folder_id',
    'label',
    'label_id',
    'from',
    'to',
    'cc',
    'bcc',
    'subject',
    'has_attachment',
    'is_unread',
    'is_read',
    'time_range',
];
function filter(args: Data): Data {
    let raw = args.filter ?? {};
    if (typeof raw === 'string') {
        raw = raw.trim();
        if (!raw) raw = {};
        else if (raw.startsWith('{')) {
            try {
                raw = JSON.parse(raw);
            } catch {
                invalid('Invalid filter JSON.');
            }
        } else {
            if (raw === 'is_unread') raw = { is_unread: true };
            else {
                const eq = raw.indexOf('=');
                if (eq < 0 || raw.includes(','))
                    invalid('Expected a JSON object or one key=value filter.');
                const key = raw.slice(0, eq).trim(),
                    value = raw.slice(eq + 1).trim();
                if (['has_attachment', 'is_unread', 'is_read'].includes(key)) {
                    if (!['true', 'false'].includes(value))
                        invalid('Expected true or false.');
                    raw = { [key]: value === 'true' };
                } else raw = { [key]: value };
            }
        }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        invalid('Filter must be an object.');
    const f: Data = { ...raw };
    for (const key of Object.keys(f)) {
        if (!filterKeys.includes(key)) invalid(`Unknown filter field: ${key}.`);
        if (['from', 'to', 'cc', 'bcc'].includes(key)) {
            if (
                !Array.isArray(f[key]) ||
                f[key].some((v: unknown) => typeof v !== 'string')
            )
                invalid(`${key} must be a string array.`);
            f[key] = f[key].map((v: string) => v.trim()).filter(Boolean);
        } else if (['has_attachment', 'is_unread', 'is_read'].includes(key)) {
            if (typeof f[key] !== 'boolean') invalid(`${key} must be boolean.`);
        } else if (key === 'time_range') {
            if (
                !f[key] ||
                typeof f[key] !== 'object' ||
                Array.isArray(f[key]) ||
                Object.keys(f[key]).some(
                    (k) => !['start_time', 'end_time'].includes(k),
                )
            )
                invalid('Invalid time_range.');
            for (const v of Object.values(f[key]))
                if (typeof v !== 'string')
                    invalid('Time range values must be ISO strings.');
        } else if (typeof f[key] !== 'string')
            invalid(`${key} must be a string.`);
    }
    for (const [flag, key] of [
        ['folder', 'folder'],
        ['folder-id', 'folder_id'],
        ['is-unread', 'is_unread'],
    ])
        if (Object.hasOwn(args, flag!)) {
            const value = args[flag!];
            if (f[key!] !== undefined && f[key!] !== value)
                invalid('Conflicting filter flags.');
            f[key!] = value;
        }
    if (f.is_unread === false || f.is_read === true)
        invalid('Only is_unread=true or is_read=false are supported.');
    if (f.is_read === false) f.is_unread = true;
    delete f.is_read;
    return f;
}
export function triagePlan(
    args: Data,
    context?: Pick<CommandContext, 'selection'>,
): Data {
    if (args['print-filter-schema'])
        return {
            schema: {
                type: 'object',
                properties: Object.fromEntries(
                    filterKeys.map((k) => [
                        k,
                        { description: `Mail filter ${k}.` },
                    ]),
                ),
                additionalProperties: false,
            },
        };
    const mb = mailbox(args, context),
        f = filter(args),
        token = String(args['page-token'] ?? '').trim(),
        query = String(args.query ?? '').trim();
    if (/[\x00-\x1f]/.test(query))
        invalid('Query contains control characters.');
    let search =
        !!query ||
        ['from', 'to', 'cc', 'bcc'].some((k) => f[k]?.length) ||
        !!f.subject ||
        f.has_attachment !== undefined ||
        (!!f.time_range && Object.values(f.time_range).some(Boolean)) ||
        [f.folder, f.label, f.label_id].some(
            (v) => labelAliases[String(v ?? '').toLowerCase()],
        ) ||
        String(f.folder).toLowerCase() === 'scheduled';
    let cursor = '';
    if (token) {
        const match = token.match(/^(search|list):(.+)$/);
        if (!match || (match[1] === 'list' && search))
            invalid('Invalid or incompatible triage page-token.');
        search = match[1] === 'search';
        cursor = match[2]!;
    }
    const maximum = Number(args.max ?? 20);
    if (!Number.isInteger(maximum)) invalid('max must be an integer.');
    const resolved: Data = { ...f },
        lookups: Data[] = [];
    const special = [f.folder, f.label_id, f.label]
        .map(
            (v) =>
                labelAliases[
                    String(v ?? '')
                        .trim()
                        .toLowerCase()
                ],
        )
        .find(Boolean);
    if (search && special) {
        resolved.folder = searchLabel[special];
        delete resolved.folder_id;
        delete resolved.label;
        delete resolved.label_id;
    } else
        for (const kind of ['folder', 'label']) {
            const explicit = !!f[`${kind}_id`],
                value = String(f[`${kind}_id`] || f[kind] || '').trim();
            delete resolved[kind];
            delete resolved[`${kind}_id`];
            if (!value) continue;
            const system = (kind === 'folder' ? folderAliases : labelAliases)[
                value.toLowerCase()
            ];
            if (system)
                resolved[search ? kind : `${kind}_id`] = search
                    ? system === 'ARCHIVED'
                        ? 'archive'
                        : system.toLowerCase()
                    : system;
            else if (
                search &&
                kind === 'folder' &&
                value.toLowerCase() === 'scheduled'
            )
                resolved.folder = 'scheduled';
            else lookups.push({ kind, value, explicit });
        }
    if (!search && (f.folder || f.folder_id) && (f.label || f.label_id))
        invalid('List filters cannot combine a folder and a label.');
    return {
        mailbox: mb,
        resolved,
        lookups,
        search,
        cursor,
        query,
        max: maximum <= 0 ? 20 : Math.min(maximum, 400),
        requests: [
            {
                method: search ? 'POST' : 'GET',
                path: path(mb, search ? 'search' : 'messages'),
            },
        ],
    };
}
export function resolveLookup(
    rows: Data[],
    value: string,
    explicit: boolean,
    search: boolean,
): string {
    const exact = rows.find((r) => r.id === value),
        matches = exact
            ? [exact]
            : explicit
              ? []
              : rows.filter(
                    (r) =>
                        String(r.name ?? '')
                            .trim()
                            .toLowerCase() === value.toLowerCase(),
                );
    const unique = [...new Map(matches.map((r) => [r.id, r])).values()];
    if (unique.length !== 1)
        invalid(
            unique.length
                ? 'Ambiguous folder or label name; use an ID.'
                : 'Folder or label not found.',
        );
    return String(unique[0]![search ? 'name' : 'id']);
}
function address(value: Data): string {
    const email = value.address ?? value.mail_address ?? '',
        name = value.name ?? '';
    return name ? `${name} <${email}>` : email;
}
function metadata(raw: Data): Data {
    return {
        message_id: raw.message_id,
        thread_id: raw.thread_id ?? '',
        subject: raw.subject ?? '',
        folder: raw.folder_id ?? '',
        ...(raw.date || raw.internal_date
            ? { date: raw.date || messageOutput(raw, false).date_formatted }
            : {}),
        ...(raw.head_from ? { from: address(raw.head_from) } : {}),
        labels: (raw.label_ids ?? []).join(','),
    };
}
function searchItems(items: Data[]): Data[] {
    return items
        .filter((i) => i.meta_data?.message_biz_id)
        .map((i) => {
            const m = i.meta_data;
            return {
                message_id: m.message_biz_id,
                thread_id: m.thread_id ?? '',
                subject: m.title ?? '',
                date: m.create_time ?? '',
                labels: '',
                ...(m.from ? { from: address(m.from) } : {}),
                ...(m.body_html ? { body_html: decode(m.body_html) } : {}),
                ...(m.body_plain_text
                    ? { body_plain_text: decode(m.body_plain_text) }
                    : {}),
            };
        });
}
export function triageProgram(): WorkflowProgram {
    return {
        id: 'mail-triage',
        version: 1,
        domain: 'mail',
        risk: 'read',
        identities: ['user', 'bot'],
        step: async (input, context) => {
            const s: Data = input;
            if (s.phase === 'start') {
                const plan = triagePlan(s.args, context);
                if (plan.schema) return { done: true, output: plan.schema };
                return {
                    done: false,
                    state: {
                        ...s,
                        ...plan,
                        phase: 'resolve',
                        index: 0,
                        messages: [],
                        ids: [],
                        notice: '',
                        pages: 0,
                    },
                };
            }
            if (s.phase === 'resolve') {
                if (s.index < s.lookups.length) {
                    const lookup = s.lookups[s.index],
                        data = await context.lark.request({
                            method: 'GET',
                            path: path(s.mailbox, `${lookup.kind}s`),
                        });
                    const value = resolveLookup(
                        (data.items ?? []) as Data[],
                        lookup.value,
                        lookup.explicit,
                        s.search,
                    );
                    return {
                        done: false,
                        state: {
                            ...s,
                            index: s.index + 1,
                            resolved: {
                                ...s.resolved,
                                [s.search ? lookup.kind : `${lookup.kind}_id`]:
                                    value,
                            },
                        },
                    };
                }
                return { done: false, state: { ...s, phase: 'pages' } };
            }
            if (s.phase === 'pages') {
                const pageSize = Math.min(
                        s.search ? 15 : 20,
                        s.max - (s.search ? s.messages.length : s.ids.length),
                    ),
                    query: Data = {
                        page_size: pageSize,
                        ...(s.cursor ? { page_token: s.cursor } : {}),
                    };
                const f = s.resolved,
                    body: Data = {};
                if (s.search) {
                    if (s.query) body.query = s.query;
                    const filter: Data = {};
                    for (const k of [
                        'from',
                        'to',
                        'cc',
                        'bcc',
                        'subject',
                        'has_attachment',
                        'is_unread',
                    ])
                        if (
                            f[k] !== undefined &&
                            (!Array.isArray(f[k]) || f[k].length)
                        )
                            filter[k] = f[k];
                    if (f.folder) filter.folder = [f.folder];
                    if (f.label) filter.label = [f.label];
                    if (f.time_range && Object.keys(f.time_range).length)
                        filter.create_time = f.time_range;
                    if (Object.keys(filter).length) body.filter = filter;
                } else {
                    if (f.label_id) query.label_id = f.label_id;
                    else query.folder_id = f.folder_id || 'INBOX';
                    if (f.is_unread) query.only_unread = true;
                }
                const data: Data = await context.lark.request({
                    method: s.search ? 'POST' : 'GET',
                    path: path(s.mailbox, s.search ? 'search' : 'messages'),
                    query,
                    ...(s.search ? { body } : {}),
                });
                const messages = s.search
                        ? [...s.messages, ...searchItems(data.items ?? [])]
                        : s.messages,
                    ids = s.search
                        ? s.ids
                        : [
                              ...s.ids,
                              ...(data.items ?? [])
                                  .map((v: unknown) =>
                                      typeof v === 'string'
                                          ? v
                                          : (v as Data)?.message_id,
                                  )
                                  .filter(Boolean),
                          ],
                    more = !!data.has_more && !!data.page_token,
                    cursor = more ? data.page_token : '',
                    count = s.search ? messages.length : ids.length;
                if (more && data.page_token === s.cursor)
                    invalid('Upstream repeated its pagination token.');
                if (more && count < s.max && s.pages < 399)
                    return {
                        done: false,
                        state: {
                            ...s,
                            messages,
                            ids,
                            cursor,
                            pages: s.pages + 1,
                            notice: s.notice || data.notice || '',
                        },
                    };
                const targets = s.search
                    ? messages.slice(0, s.max).map((m: Data) => m.message_id)
                    : ids.slice(0, s.max);
                return {
                    done: false,
                    state: {
                        ...s,
                        messages: messages.slice(0, s.max),
                        ids: targets,
                        cursor,
                        more,
                        notice: s.notice || data.notice || '',
                        phase: 'metadata',
                        batches:
                            !s.search || s.args.labels
                                ? chunks(targets, 20)
                                : [],
                        index: 0,
                        metas: [],
                    },
                };
            }
            if (s.index < s.batches.length) {
                const data: Data = await context.lark.request({
                    method: 'POST',
                    path: path(s.mailbox, 'messages', 'batch_get'),
                    body: {
                        format: 'metadata',
                        message_ids: s.batches[s.index],
                    },
                });
                return {
                    done: false,
                    state: {
                        ...s,
                        index: s.index + 1,
                        metas: [
                            ...s.metas,
                            ...(data.messages ?? []).map(metadata),
                        ],
                    },
                };
            }
            const indexed = new Map<string, Data>(
                s.metas.map((m: Data) => [m.message_id, m]),
            );
            const messages = (
                s.search
                    ? s.messages.map((m: Data) => ({
                          ...m,
                          ...(s.args.labels
                              ? {
                                    labels:
                                        indexed.get(m.message_id)?.labels ?? '',
                                }
                              : {}),
                      }))
                    : s.ids.map(
                          (id: string) =>
                              indexed.get(id) ?? {
                                  message_id: id,
                                  error: 'metadata not returned by batch_get',
                              },
                      )
            ).map((m: Data) => ({ ...m, mailbox_id: s.mailbox }));
            return {
                done: true,
                output: {
                    messages,
                    mailbox_id: s.mailbox,
                    count: messages.length,
                    has_more: s.more,
                    page_token: s.cursor
                        ? `${s.search ? 'search' : 'list'}:${s.cursor}`
                        : '',
                    ...(s.notice ? { notice: s.notice } : {}),
                },
            };
        },
    };
}

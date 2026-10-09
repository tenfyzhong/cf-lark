import type { ArtifactFiles } from '../../ports/artifacts';
import { readMailText } from './files';
import { ServiceError } from '../../domain/errors';
import type { CommandContext } from '../../ports/capabilities';
import type { WorkflowProgram } from '../../ports/workflows';
import { invalid, list, mailbox, path, required, type Data } from './common';
type Alias = {
    name: string;
    code: number;
    argument: boolean;
    aliases: string[];
};
const aliases = (rows: [string, number, boolean, string?][]): Alias[] =>
    rows.map(([name, code, argument, names]) => ({
        name,
        code,
        argument,
        aliases: names?.split(',') ?? [],
    }));
const fields = aliases([
    ['from', 1, true, 'sender'],
    ['to', 2, true, 'recipient'],
    ['cc', 3, true],
    ['to_or_cc', 4, true, 'recipient_or_cc'],
    ['subject', 6, true, 'title'],
    ['body', 7, true, 'content'],
    ['attachment_name', 8, true, 'attach_name'],
    ['attachment_type', 9, true, 'attach_type'],
    ['any_address', 10, true, 'any_recipient'],
    ['all_mail', 12, false, 'all'],
    ['external', 13, false, 'external_mail'],
    ['spam', 14, false, 'is_spam'],
    ['not_spam', 15, false, 'is_not_spam'],
    ['has_attachment', 16, false, 'has_attach'],
]);
const operators = aliases([
    ['contains', 1, true, 'include'],
    ['not_contains', 2, true, 'exclude'],
    ['starts_with', 3, true, 'prefix'],
    ['ends_with', 4, true, 'suffix'],
    ['equals', 5, true, 'eq,is'],
    ['not_equals', 6, true, 'ne'],
    ['contains_self', 7, false, 'self'],
    ['empty', 10, false, 'is_empty'],
]);
const actions = aliases([
    ['archive', 1, false],
    ['delete_mail', 2, false, 'trash'],
    ['mark_read', 3, false, 'read'],
    ['move_spam', 4, false, 'spam'],
    ['not_spam', 5, false, 'never_spam'],
    ['star', 9, false, 'flag,add_flag,add_star'],
    ['mute_notification', 10, false, 'mute'],
    ['move_folder', 11, true, 'folder,move_to'],
]);
function lookup(items: Alias[], name: unknown): Alias {
    const text = String(name ?? '').trim(),
        found = items.find((a) => a.name === text || a.aliases.includes(text));
    if (!found) invalid(`Unknown rule alias: ${text}.`);
    return found;
}
function condition(value: Data | string): Data {
    const parts = typeof value === 'string' ? value.split(':') : [];
    const raw =
        typeof value === 'string'
            ? {
                  field: parts[0],
                  operator: parts[1] ?? '',
                  value: parts.slice(2).join(':'),
              }
            : value;
    if (!raw || typeof raw !== 'object')
        invalid('Condition must be an object or grammar string.');
    const field = lookup(fields, raw.field),
        op = String(raw.operator ?? raw.op ?? ''),
        text = String(raw.value ?? '');
    if (!field.argument) {
        if (op || text)
            invalid('Boolean conditions accept no operator or value.');
        return { field: field.name };
    }
    const operator = lookup(operators, op);
    if (operator.argument ? !text.trim() : !!text.trim())
        invalid('Condition value does not match the operator.');
    return {
        field: field.name,
        operator: operator.name,
        ...(text ? { value: text } : {}),
    };
}
function action(value: Data | string): Data {
    let raw: Data;
    if (typeof value === 'string') {
        const separator = value.indexOf(':'),
            tail = separator < 0 ? '' : value.slice(separator + 1).trim();
        raw = {
            kind: separator < 0 ? value : value.slice(0, separator),
            params: {},
        };
        if (tail) {
            const eq = tail.indexOf('=');
            if (eq < 0) invalid('Action parameter must use key=value.');
            if (tail.startsWith('json=')) {
                try {
                    raw.params = JSON.parse(tail.slice(5));
                } catch {
                    invalid('Invalid action JSON.');
                }
            } else
                raw.params[tail.slice(0, eq).trim()] = tail
                    .slice(eq + 1)
                    .trim();
        }
    } else raw = value;
    if (!raw || typeof raw !== 'object')
        invalid('Action must be an object or grammar string.');
    const kind = lookup(actions, raw.kind),
        params: Data = { ...(raw.params ?? {}) };
    if (
        raw.params !== undefined &&
        (!raw.params ||
            typeof raw.params !== 'object' ||
            Array.isArray(raw.params))
    )
        invalid('Action params must be an object.');
    if (
        Object.keys(raw).some(
            (k) =>
                ![
                    'kind',
                    'params',
                    ...(kind.argument ? ['folder_id'] : []),
                ].includes(k),
        )
    )
        invalid('Unexpected action field.');
    if (raw.folder_id !== undefined) params.folder_id = raw.folder_id;
    const normalized: Data = {};
    for (const [key, value] of Object.entries(params)) {
        const text = String(value).trim();
        if (!text) continue;
        if (!kind.argument || key.trim() !== 'folder_id')
            invalid('Unexpected action parameter.');
        normalized.folder_id = text;
    }
    if (kind.argument && !normalized.folder_id)
        invalid('move_folder requires folder_id.');
    return {
        kind: kind.name,
        ...(Object.keys(normalized).length ? { params: normalized } : {}),
    };
}
function collection(args: Data, singular: string): Data[] {
    const inputs = [args[singular], args[`${singular}s`]].filter(
        (v) => v !== undefined && v !== '',
    );
    let bytes = 0;
    const output: Data[] = [];
    const append = (input: unknown): void => {
        if (Array.isArray(input)) {
            input.forEach(append);
            return;
        }
        if (typeof input === 'string' && input.startsWith('@')) return;
        bytes += new TextEncoder().encode(
            typeof input === 'string' ? input : JSON.stringify(input),
        ).length;
        if (bytes > 1 << 20) invalid('Rule input exceeds 1 MiB.');
        if (typeof input === 'string' && /^[\[{]/.test(input.trim())) {
            let parsed;
            try {
                parsed = JSON.parse(input);
            } catch {
                invalid('Invalid rule JSON.');
            }
            if (Array.isArray(parsed))
                parsed.forEach((v) =>
                    output.push(
                        singular === 'condition' ? condition(v) : action(v),
                    ),
                );
            else
                output.push(
                    singular === 'condition'
                        ? condition(parsed)
                        : action(parsed),
                );
        } else
            output.push(
                singular === 'condition'
                    ? condition(input as Data | string)
                    : action(input as Data | string),
            );
        if (output.length > 100)
            invalid('At most 100 rule entries are supported.');
    };
    inputs.forEach(append);
    return output;
}
function encode(rule: Data): Data {
    return {
        name: rule.name,
        is_enable: rule.enabled,
        ignore_the_rest_of_rules: rule.stop_after_match,
        condition: {
            match_type: rule.match === 'any' ? 2 : 1,
            items: (rule.conditions ?? []).map((c: Data) => ({
                type: lookup(fields, c.field).code,
                ...(c.operator
                    ? { operator: lookup(operators, c.operator).code }
                    : {}),
                ...(c.value ? { input: c.value } : {}),
            })),
        },
        action: {
            items: (rule.actions ?? []).map((a: Data) => ({
                type: lookup(actions, a.kind).code,
                ...(a.params?.folder_id ? { input: a.params.folder_id } : {}),
            })),
        },
    };
}
function spec(rule: Data, mb: string): Data {
    return { version: 'mail_rule/v1', mailbox: { user_mailbox_id: mb }, rule };
}
export function decodeRule(raw: Data, mb: string): Data {
    const unknowns: Data[] = [],
        conditions: Data[] = [],
        decodedActions: Data[] = [];
    const warn = (location: string, reason: string, value: unknown) =>
        unknowns.push({ path: location, reason, raw: value });
    const extras = (value: Data, allowed: string[], location: string) => {
        for (const key of Object.keys(value).sort())
            if (!allowed.includes(key))
                warn(`${location}.${key}`, 'unknown field', value[key]);
    };
    const bool = (value: unknown, fallback: boolean): boolean =>
        value === undefined
            ? fallback
            : typeof value === 'string'
              ? value === 'true' || value === '1'
              : !!value;
    const rule: Data = {
        id: String(raw.rule_id ?? raw.id ?? ''),
        name: String(raw.name ?? raw.rule_name ?? ''),
        enabled: bool(raw.is_enable ?? raw.enabled, true),
        stop_after_match: bool(raw.ignore_the_rest_of_rules, false),
        match: 'all',
        conditions,
        actions: decodedActions,
    };
    if (raw.condition && typeof raw.condition === 'object') {
        extras(raw.condition, ['match_type', 'items'], 'condition');
        const mt = Number(raw.condition.match_type ?? 1);
        rule.match = mt === 1 ? 'all' : mt === 2 ? 'any' : '';
        if (!rule.match)
            warn(
                'condition.match_type',
                'unknown match_type enum',
                raw.condition.match_type,
            );
        for (const [i, c] of (raw.condition.items ?? []).entries()) {
            const location = `condition.items[${i}]`,
                field = fields.find((f) => f.code === Number(c?.type));
            if (!field) {
                warn(location, 'unknown condition type enum', c);
                continue;
            }
            const op = operators.find((o) => o.code === Number(c.operator));
            if (field.argument && !op) {
                warn(
                    `${location}.operator`,
                    'unknown condition operator enum',
                    c,
                );
                continue;
            }
            extras(
                c,
                field.argument
                    ? ['type', 'operator', 'input', 'value']
                    : ['type'],
                location,
            );
            conditions.push({
                field: field.name,
                ...(op && field.argument
                    ? {
                          operator: op.name,
                          ...(c.input || c.value
                              ? { value: String(c.input || c.value) }
                              : {}),
                      }
                    : {}),
            });
        }
    }
    if (raw.action && typeof raw.action === 'object') {
        extras(raw.action, ['items'], 'action');
        for (const [i, a] of (raw.action.items ?? []).entries()) {
            const location = `action.items[${i}]`,
                kind = actions.find((k) => k.code === Number(a?.type));
            if (!kind) {
                warn(location, 'unknown action type enum', a);
                continue;
            }
            extras(
                a,
                kind.argument
                    ? ['type', 'folder_id', 'input', 'params']
                    : ['type'],
                location,
            );
            if (a.params && kind.argument)
                extras(a.params, ['folder_id', 'input'], `${location}.params`);
            const folder =
                a.params?.input ||
                a.params?.folder_id ||
                a.input ||
                a.folder_id;
            decodedActions.push({
                kind: kind.name,
                ...(kind.argument && folder
                    ? { params: { folder_id: String(folder) } }
                    : {}),
            });
        }
    }
    return {
        ...(rule.id ? { rule_id: rule.id } : {}),
        ...(rule.name ? { name: rule.name } : {}),
        enabled: rule.enabled,
        ...((raw.order ?? raw.sequence ?? raw.priority ?? raw.index) !==
        undefined
            ? { order: raw.order ?? raw.sequence ?? raw.priority ?? raw.index }
            : {}),
        description: `${rule.enabled ? 'Enabled' : 'Disabled'} rule ${rule.name || rule.id}: match ${rule.match || 'unknown'}; ${conditions.map((c) => [c.field, c.operator, c.value].filter(Boolean).join(' ')).join('; ')}; ${decodedActions.map((a) => a.kind).join(', ')}${unknowns.length ? '; includes unknown fields' : ''}`,
        semantic_spec: spec(rule, mb),
        ...(unknowns.length ? { unknowns } : {}),
        raw,
    };
}
function items(data: Data): Data[] {
    for (const key of ['rules', 'items', 'rule_list', 'user_rules'])
        if (Array.isArray(data[key]))
            return data[key].filter((v: unknown) => v && typeof v === 'object');
    return data.rule ? [data.rule] : data.name !== undefined ? [data] : [];
}
const changed = (args: Data, ...keys: string[]) =>
    keys.some((key) => Object.hasOwn(args, key));
function artifactReferences(value: unknown): boolean {
    return Array.isArray(value)
        ? value.some(artifactReferences)
        : typeof value === 'string' && value.startsWith('@');
}
export function rulePlan(
    actionName: string,
    args: Data,
    context?: Pick<CommandContext, 'selection'>,
): Data {
    const mb = mailbox(
            { mailbox: String(args['user-mailbox-id'] ?? '').trim() || 'me' },
            context,
        ),
        collectionPath = path(mb, 'rules');
    if (!['rule-list', 'rule-create', 'rule-reorder'].includes(actionName))
        required(args['rule-id'], 'rule-id');
    if (actionName === 'rule-reorder') {
        const full = list(args['rule-ids']).map((s) => s.trim()),
            choices = [
                'before-rule-id',
                'after-rule-id',
                'to-top',
                'to-bottom',
            ].filter((k) => !!args[k]);
        if (
            full.length
                ? !!args['move-rule-id'] || choices.length > 0
                : !args['move-rule-id'] || choices.length !== 1
        )
            invalid('Provide a full order or one relative move.');
        if (new Set(full).size !== full.length || full.some((v) => !v))
            invalid('Rule IDs must be unique and nonempty.');
        return {
            mailbox: mb,
            full,
            requests: [
                { method: 'GET', path: collectionPath },
                {
                    method: 'POST',
                    path: path(mb, 'rules', 'reorder'),
                    body: { rule_ids: '<computed>' },
                },
            ],
        };
    }
    if (!['rule-create', 'rule-update'].includes(actionName))
        return {
            mailbox: mb,
            requests: [{ method: 'GET', path: collectionPath }],
        };
    if (
        (args.enable && args.disable) ||
        (args['stop-after-match'] && args['continue-after-match'])
    )
        invalid('Conflicting rule flags.');
    if (
        actionName === 'rule-update' &&
        !changed(
            args,
            'name',
            'enable',
            'disable',
            'match',
            'stop-after-match',
            'continue-after-match',
            'condition',
            'conditions',
            'action',
            'actions',
        )
    )
        invalid('At least one update field is required.');
    const rule: Data = {
        name: String(args.name ?? '').trim(),
        enabled: args.disable !== true,
        stop_after_match: args['stop-after-match'] === true,
        match: String(args.match ?? '').trim() || 'all',
        conditions: collection(args, 'condition'),
        actions: collection(args, 'action'),
    };
    if (!['all', 'any'].includes(rule.match))
        invalid('match must be all or any.');
    if (actionName === 'rule-create' && !rule.name)
        invalid('Rule name is required.');
    if (
        (actionName === 'rule-create' ||
            changed(args, 'condition', 'conditions')) &&
        !rule.conditions.length &&
        !artifactReferences(args.condition) &&
        !artifactReferences(args.conditions)
    )
        invalid('At least one condition is required.');
    if (
        (actionName === 'rule-create' || changed(args, 'action', 'actions')) &&
        !rule.actions.length &&
        !artifactReferences(args.action) &&
        !artifactReferences(args.actions)
    )
        invalid('At least one action is required.');
    const raw = encode(rule);
    return {
        mailbox: mb,
        semantic_spec: spec(rule, mb),
        raw,
        requests: [
            {
                method: actionName === 'rule-create' ? 'POST' : 'GET',
                path: collectionPath,
                ...(actionName === 'rule-create' ? { body: raw } : {}),
            },
        ],
    };
}
function targetOrder(args: Data, ids: string[], full: string[]): string[] {
    if (full.length) {
        if (full.length !== ids.length || full.some((id) => !ids.includes(id)))
            invalid('Full order must contain every current rule exactly once.');
        return full;
    }
    const move = String(args['move-rule-id']).trim(),
        anchor = String(
            args['before-rule-id'] || args['after-rule-id'] || '',
        ).trim();
    if (
        !ids.includes(move) ||
        (anchor && (!ids.includes(anchor) || anchor === move))
    )
        invalid('Move and target IDs must name distinct existing rules.');
    const result = ids.filter((id) => id !== move);
    const index = args['to-top']
        ? 0
        : args['to-bottom']
          ? result.length
          : result.indexOf(anchor) + (args['after-rule-id'] ? 1 : 0);
    result.splice(index, 0, move);
    return result;
}
function merge(args: Data, before: Data): Data {
    const rule = { ...before.semantic_spec.rule },
        partial = rulePlan('rule-update', args).semantic_spec.rule,
        diff: Data[] = [];
    const changes: [string, string[]][] = [
        ['name', ['name']],
        ['enabled', ['enable', 'disable']],
        ['match', ['match']],
        ['stop_after_match', ['stop-after-match', 'continue-after-match']],
        ['conditions', ['condition', 'conditions']],
        ['actions', ['action', 'actions']],
    ];
    for (const [field, flags] of changes)
        if (changed(args, ...flags)) {
            if (JSON.stringify(rule[field]) !== JSON.stringify(partial[field]))
                diff.push({
                    field,
                    before: rule[field],
                    after: partial[field],
                });
            rule[field] = partial[field];
        }
    const encoded = encode(rule),
        raw: Data = {};
    for (const key of [
        'name',
        'is_enable',
        'ignore_the_rest_of_rules',
        'condition',
        'action',
    ])
        raw[key] = before.raw[key] ?? encoded[key];
    for (const key of ['name', 'is_enable', 'ignore_the_rest_of_rules'])
        raw[key] = encoded[key];
    if (changed(args, 'condition', 'conditions'))
        raw.condition = changed(args, 'match')
            ? encoded.condition
            : { ...raw.condition, items: encoded.condition.items };
    else if (changed(args, 'match'))
        raw.condition = {
            ...raw.condition,
            match_type: encoded.condition.match_type,
        };
    if (changed(args, 'action', 'actions')) raw.action = encoded.action;
    return { rule, raw, diff };
}
export function ruleProgram(
    readOnly = false,
    artifacts?: ArtifactFiles,
): WorkflowProgram {
    return {
        id: readOnly ? 'mail-rules-read' : 'mail-rules',
        version: 1,
        domain: 'mail',
        risk: readOnly ? 'read' : 'write',
        identities: ['user', 'bot'],
        step: async (input, context) => {
            const state: Data = input,
                action = state.action,
                args = state.args;
            if (state.phase === 'start') {
                const expanded = { ...args };
                const expand = async (value: unknown): Promise<unknown> =>
                    Array.isArray(value)
                        ? Promise.all(value.map(expand))
                        : typeof value === 'string' && value.startsWith('@')
                          ? readMailText(value, context, artifacts)
                          : value;
                for (const key of [
                    'condition',
                    'conditions',
                    'action',
                    'actions',
                ])
                    if (args[key] !== undefined) {
                        expanded[key] = await expand(args[key]);
                        if (artifactReferences(expanded[key])) invalid('Nested artifact references are not supported in rule content.');
                    }
                return {
                    done: false,
                    state: {
                        ...state,
                        args: expanded,
                        ...rulePlan(action, expanded, context),
                        phase: 'read',
                    },
                };
            }
            if (state.phase === 'read') {
                const data = await context.lark.request(state.requests[0]);
                if (action === 'rule-create') {
                    const result = items(data)[0] ?? data,
                        recognizable = [
                            'rule_id',
                            'id',
                            'name',
                            'rule_name',
                            'is_enable',
                            'enabled',
                            'condition',
                            'action',
                        ].some((key) => Object.hasOwn(result, key));
                    return {
                        done: true,
                        output: {
                            rule: decodeRule(
                                recognizable ? result : state.raw,
                                state.mailbox,
                            ),
                            semantic_spec: state.semantic_spec,
                        },
                    };
                }
                const all = items(data).map((raw) =>
                    decodeRule(raw, state.mailbox),
                );
                if (action === 'rule-list') {
                    const search = String(args['name-contains'] ?? '')
                            .trim()
                            .toLowerCase(),
                        rules = all.filter(
                            (rule) =>
                                !search ||
                                String(rule.name ?? '')
                                    .toLowerCase()
                                    .includes(search),
                        );
                    return {
                        done: true,
                        output: { rules, total: rules.length },
                    };
                }
                if (action === 'rule-reorder') {
                    const ids = all.map((rule) => rule.rule_id).filter(Boolean),
                        target = targetOrder(args, ids, state.full);
                    return {
                        done: false,
                        state: {
                            ...state,
                            phase: 'write',
                            beforeIds: ids,
                            target,
                            request: {
                                method: 'POST',
                                path: path(state.mailbox, 'rules', 'reorder'),
                                body: { rule_ids: target },
                            },
                        },
                    };
                }
                const before = all.find(
                    (rule) => rule.rule_id === args['rule-id'],
                );
                if (!before)
                    throw new ServiceError(
                        'NOT_FOUND',
                        'Mail rule not found.',
                        404,
                    );
                if (action === 'rule-get')
                    return { done: true, output: before };
                if (action === 'rule-delete')
                    return {
                        done: false,
                        state: {
                            ...state,
                            before,
                            phase: 'write',
                            request: {
                                method: 'DELETE',
                                path: path(
                                    state.mailbox,
                                    'rules',
                                    args['rule-id'],
                                ),
                            },
                        },
                    };
                const toggle =
                        action === 'rule-enable' || action === 'rule-disable',
                    changes = toggle
                        ? {
                              ...args,
                              ...(action === 'rule-enable'
                                  ? { enable: true }
                                  : { disable: true }),
                          }
                        : args,
                    merged = merge(changes, before);
                if (!merged.diff.length)
                    return {
                        done: true,
                        output: {
                            before: toggle
                                ? { enabled: before.enabled }
                                : before,
                            after: before,
                            diff: [],
                            no_op: true,
                        },
                    };
                return {
                    done: false,
                    state: {
                        ...state,
                        before,
                        ...merged,
                        toggle,
                        phase: 'write',
                        request: {
                            method: 'PUT',
                            path: path(state.mailbox, 'rules', args['rule-id']),
                            body: merged.raw,
                        },
                    },
                };
            }
            if (state.phase === 'write') {
                await context.lark.request(state.request);
                if (action === 'rule-delete')
                    return {
                        done: true,
                        output: { deleted: true, rule: state.before },
                    };
                if (action === 'rule-reorder')
                    return {
                        done: true,
                        output: {
                            before_rule_ids: state.beforeIds,
                            after_rule_ids: state.target,
                            raw_request: state.request.body,
                        },
                    };
                if (state.toggle)
                    return {
                        done: true,
                        output: {
                            before: { enabled: state.before.enabled },
                            after: decodeRule(
                                { ...state.raw, rule_id: args['rule-id'] },
                                state.mailbox,
                            ),
                            diff: state.diff,
                            raw_request: state.raw,
                        },
                    };
                return { done: false, state: { ...state, phase: 'readback' } };
            }
            let after: Data,
                failure = '';
            try {
                const data = await context.lark.request({
                    method: 'GET',
                    path: path(state.mailbox, 'rules'),
                });
                const found = items(data).find(
                    (raw) => (raw.rule_id ?? raw.id) === args['rule-id'],
                );
                if (!found)
                    throw new ServiceError(
                        'NOT_FOUND',
                        'Updated rule not found.',
                    );
                after = decodeRule(found, state.mailbox);
            } catch (error) {
                after = decodeRule(
                    { ...state.raw, rule_id: args['rule-id'] },
                    state.mailbox,
                );
                failure =
                    error instanceof Error ? error.message : 'Readback failed.';
            }
            return {
                done: true,
                output: {
                    before: state.before,
                    after,
                    diff: state.diff,
                    raw_request: state.raw,
                    ...(failure
                        ? { after_is_fallback: true, after_read_error: failure }
                        : {}),
                },
            };
        },
    };
}

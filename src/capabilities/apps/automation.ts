import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function text(args: JsonObject, key: string) { return typeof args[key] === 'string' ? args[key].trim() : ''; }
const families: Record<string, string> = { cron: 'cron', timezone: 'cron', table: 'record-change', event: 'record-change', fields: 'record-change', 'white-ip-list': 'webhook', 'event-type': 'feishu-approval', 'instance-status': 'feishu-approval', 'task-status': 'feishu-approval', 'approval-code': 'feishu-approval' };
const types = ['cron', 'record-change', 'webhook', 'feishu-approval'];
function set(args: JsonObject, key: string) { return Array.isArray(args[key]) ? args[key].length > 0 : !!text(args, key); }
function array(args: JsonObject, key: string): string[] {
    if (!text(args, key)) return [];
    let value: unknown; try { value = JSON.parse(String(args[key])); } catch { invalid(`${key} must be a JSON array of strings.`); }
    if (value === null) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) invalid(`${key} must be a JSON array of strings.`);
    return value;
}
function cron(value: string) {
    const parts = value.split(/\s+/); if (parts.length !== 5) invalid('cron must have five fields.');
    const minute = parts[0]!;
    if (minute === '*/30') return;
    const values = minute.split(',');
    if (values.some((part) => !/^\d+$/.test(part) || Number(part) > 59)) invalid('Unsupported cron minute syntax.');
    const sorted = values.map(Number).sort((a, b) => a - b);
    if (sorted.length > 1 && sorted.some((value, index) => ((sorted[(index + 1) % sorted.length]! + (index === sorted.length - 1 ? 60 : 0)) - value) < 30)) invalid('Cron requires a minimum 30-minute interval.');
}
function validIP(value: string) {
    const parts = value.split('/'); if (parts.length > 2) return false;
    const ip = parts[0]!;
    let bits = 32;
    if (ip.includes(':')) { bits = 128; try { new URL(`https://[${ip}]/`); } catch { return false; } }
    else if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || ip.split('.').some((part) => Number(part) > 255 || part.length > 1 && part.startsWith('0'))) return false;
    return parts.length === 1 || /^\d+$/.test(parts[1]!) && Number(parts[1]) <= bits;
}
function condition(family: string, args: JsonObject): JsonObject {
    if (family === 'cron') { const expression = text(args, 'cron'); cron(expression); return { cron: expression, timezone: text(args, 'timezone') || 'Asia/Shanghai' }; }
    if (family === 'record-change') {
        const table = text(args, 'table'), event = text(args, 'event').toUpperCase(), fields = array(args, 'fields');
        if (!table || !['INSERT', 'UPDATE', 'UPSERT', 'DELETE'].includes(event)) invalid('Record-change requires table and a valid event.');
        return { table, event, ...(fields.length ? { fields } : {}) };
    }
    if (family === 'webhook') {
        const ips = array(args, 'white-ip-list').map((ip) => ip.trim());
        if (ips.some((ip) => !validIP(ip))) invalid('white-ip-list contains an invalid IP or CIDR.');
        return { white_ip_list: ips };
    }
    const event = text(args, 'event-type');
    if (!['approval_instance', 'approval_task'].includes(event)) invalid('Approval event-type must be approval_instance or approval_task.');
    const flag = event === 'approval_task' ? 'task-status' : 'instance-status';
    const statuses = Array.isArray(args[flag]) ? args[flag].map((value: unknown) => typeof value === 'string' ? value.trim().toUpperCase() : '') : [];
    const allowed = ['REVERTED', 'PENDING', 'APPROVED', 'REJECTED', 'OVERTIME_CLOSE', 'OVERTIME_RECOVER', ...(event === 'approval_task' ? ['TRANSFERRED', 'ROLLBACK', 'DONE'] : ['CANCELED', 'DELETED'])];
    if (!statuses.length || statuses.some((status: string) => !allowed.includes(status))) invalid('Approval statuses must match event-type.');
    return { event_type: event, status: statuses, ...(text(args, 'approval-code') ? { approval_code: text(args, 'approval-code') } : {}) };
}
export function automationRequest(action: string, args: JsonObject, path: string, preview: boolean): ApiRequest {
    path += '/triggers';
    const family = text(args, 'trigger-type');
    if (action === 'list') {
        if (family && !types.includes(family)) invalid('Invalid trigger-type.');
        return { method: 'GET', path, query: { ...(family ? { trigger_type: family.replaceAll('-', '_') } : {}), ...('page-size' in args ? { page_size: args['page-size'] } : {}), ...(text(args, 'page-token') ? { page_token: text(args, 'page-token') } : {}) } };
    }
    const name = text(args, 'name'); if (!name) invalid('name must not be blank.');
    if (action !== 'create') path += `/${encodeURIComponent(name)}`;
    if (action === 'get') return { method: 'GET', path };
    if (action === 'enable' || action === 'disable') return { method: 'PATCH', path, body: { status: action === 'enable' ? 'enabled' : 'disabled' } };
    const actions = ['reset-url', 'enable-token', 'disable-token', 'reset-token'].filter((key) => args[key] === true);
    const used = Object.keys(families).filter((key) => set(args, key));
    if (action === 'update') {
        const appEnv = text(args, 'app-env');
        if (appEnv && (args['reset-url'] !== true || !['preview', 'runtime'].includes(appEnv))) invalid('app-env requires reset-url and preview/runtime.');
        if (actions.length > 1) invalid('Only one webhook action is allowed.');
        if (actions.length) {
            if (used.length || text(args, 'description')) invalid('Webhook actions cannot be combined with conditions.');
            if (actions[0] === 'reset-url' && !appEnv) invalid('reset-url requires app-env.');
            confirm(args, preview);
            if (actions[0] === 'reset-url') return { method: 'POST', path: `${path}/webhook/url/reset`, body: { app_env: appEnv } };
            if (actions[0] === 'reset-token') return { method: 'POST', path: `${path}/webhook/token/reset`, body: { token_type: 'bearerToken' } };
            return { method: 'PATCH', path: `${path}/webhook/token/status`, body: { status: actions[0] === 'enable-token' ? 'enabled' : 'disabled', token_type: 'bearerToken' } };
        }
        if (set(args, 'timezone') && !set(args, 'cron')) invalid('timezone requires cron.');
        if (!set(args, 'event-type') && ['approval-code', 'instance-status', 'task-status'].some((key) => set(args, key))) invalid('Approval options require event-type.');
        if (text(args, 'event-type') === 'approval_instance' && set(args, 'task-status') || text(args, 'event-type') === 'approval_task' && set(args, 'instance-status')) invalid('Status option does not match event-type.');
    }
    if (family && !types.includes(family) || action === 'create' && !family) invalid('Invalid trigger-type.');
    const active = [...new Set(used.map((key) => families[key]!))];
    if (active.length > 1 || family && active.some((value) => value !== family)) invalid('Condition families cannot be mixed.');
    const body: JsonObject = {};
    const description = text(args, 'description');
    if ([...description].length > 50 || action === 'create' && [...name].length > 100) invalid('Trigger name or description exceeds its limit.');
    if (description) body.description = description;
    if (action === 'create') {
        body.name = name; body.trigger_type = family.replaceAll('-', '_');
        if (text(args, 'status')) { if (!['enabled', 'disabled'].includes(text(args, 'status'))) invalid('Invalid status.'); body.status = text(args, 'status'); }
    }
    const selected = action === 'create' ? family : active[0];
    if (selected) body[`${selected.replaceAll('-', '_')}_condition`] = condition(selected, args);
    if (!Object.keys(body).length) invalid('Provide at least one update field.');
    if (action === 'update') confirm(args, preview);
    return { method: action === 'create' ? 'POST' : 'PUT', path, body };
}
function confirm(args: JsonObject, preview: boolean) { if (!preview && args.yes !== true) throw new ServiceError('CONFIRMATION_REQUIRED', 'Explicit yes=true is required.'); }
function redact(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const result = { ...value } as JsonObject;
    if (result.trigger && typeof result.trigger === 'object' && !Array.isArray(result.trigger)) result.trigger = redact(result.trigger);
    else if (result.trigger_condition && typeof result.trigger_condition === 'object' && !Array.isArray(result.trigger_condition)) {
        const condition = result.trigger_condition as JsonObject;
        result.trigger_condition = { ...condition, ...('token_value' in condition ? { token_value: null } : {}) };
    }
    return result;
}
export function automationResult(action: string, args: JsonObject, data: JsonObject): JsonObject {
    if (action === 'list') return { items: (Array.isArray(data.items) ? data.items : []).map(redact), has_more: data.has_more ?? null, page_token: data.page_token ?? null };
    if (action === 'update') {
        if (args['disable-token'] === true) return { name: text(args, 'name'), token_enabled: false };
        if (args['enable-token'] === true || args['reset-token'] === true) return { token_value: text(data, 'token_value') || text(data, 'token'), token_enabled: true };
        if (args['reset-url'] === true) return data;
    }
    return redact(data) as JsonObject;
}

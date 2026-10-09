import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
const roles = ['view', 'edit', 'full_access'];
export const memberSettings: Record<string, string[]> = {
    external_access: ['enabled', 'disabled'], external_invite: ['enabled', 'disabled'],
    link_share: ['closed', 'tenant-readable', 'tenant-editable', 'anyone-readable'],
    manage_collaborators_by: ['anyone', 'same-tenant', 'full-access'], comment_by: ['viewer', 'editor'], copy_download_by: ['viewer', 'editor', 'full-access'],
};
const writable = ['external_access', 'link_share', 'manage_collaborators_by', 'comment_by'];
const identities: Record<string, [string, string]> = { openid: ['user_open_id', 'ou_'], openchat: ['chat_id', 'oc_'], opendepartmentid: ['department_id', 'od-'] };
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function malformed(): never { throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'The collaborator response has an unsupported or malformed shape.', 502); }
function text(args: JsonObject, key: string) { return typeof args[key] === 'string' ? args[key].trim() : ''; }
function validID(value: unknown, prefix: string): value is string { return typeof value === 'string' && value.startsWith(prefix) && value.length > prefix.length && !/[\s\p{Cc}?#%/\\]/u.test(value); }
function object(value: unknown): JsonObject { if (!value || typeof value !== 'object' || Array.isArray(value)) malformed(); return value as JsonObject; }
export function memberRequest(name: string, args: JsonObject, path: string, preview: boolean): ApiRequest {
    const app = text(args, 'app-id');
    if (!validID(app, 'app_') || /[\u200b-\u200d\ufeff\u2028-\u202e\u2066-\u2069]/u.test(app)) invalid('app-id must be a valid app_ identifier.');
    if (name.startsWith('member-settings-')) {
        path += '/member-settings';
        if (name === 'member-settings-get') return { method: 'GET', path };
        const body: JsonObject = {};
        for (const key of writable) {
            const flag = key.replaceAll('_', '-');
            if (!(flag in args)) continue;
            const value = text(args, flag);
            if (!memberSettings[key]!.includes(value)) invalid(`Invalid ${flag} setting.`);
            body[key] = value;
        }
        if (!Object.keys(body).length) invalid('Provide at least one writable collaborator setting.');
        return { method: 'PATCH', path, body };
    }
    path += '/members';
    if (name === 'member-list') {
        const query: JsonObject = {};
        for (const [flag, values] of [['role', roles], ['member-type', ['user', 'department', 'chat']]] as const) {
            const value = text(args, flag); if (!value) continue;
            if (!(values as readonly string[]).includes(value)) invalid(`Unsupported ${flag}.`);
            query[flag.replaceAll('-', '_')] = value;
        }
        return { method: 'GET', path, query };
    }
    const identity = identities[text(args, 'member-type')], id = text(args, 'member-id');
    if (!identity || !validID(id, identity[1])) invalid('member-id must match its external member-type.');
    const body: JsonObject = { [identity[0]]: id };
    if (name === 'member-remove') {
        if (!preview && args.yes !== true) throw new ServiceError('CONFIRMATION_REQUIRED', 'Explicit yes=true is required.');
        return { method: 'POST', path: `${path}/remove`, body };
    }
    const role = text(args, 'perm'); if (!roles.includes(role)) invalid('perm must be view, edit, or full_access.');
    body.role = role;
    if (name === 'member-add' && 'need-notification' in args) body.need_notification = args['need-notification'];
    return { method: name === 'member-add' ? 'POST' : 'PATCH', path, body };
}
function record(value: unknown): JsonObject {
    const data = object(value), type = data.member_type;
    const identity = type === 'user' ? identities.openid : type === 'chat' ? identities.openchat : type === 'department' ? identities.opendepartmentid : undefined;
    if (!identity || !roles.includes(String(data.role)) || Object.values(identities).filter(([field]) => data[field] != null).length !== 1 || !validID(data[identity[0]], identity[1])) malformed();
    if (data.name != null && typeof data.name !== 'string') malformed();
    return { member_type: type, member_id: data[identity[0]], role: data.role, ...(data.name ? { name: data.name } : {}) };
}
function settingObject(value: unknown): JsonObject {
    const source = object(value), result: JsonObject = {};
    for (const [key, allowed] of Object.entries(memberSettings)) {
        if (source[key] == null) continue;
        if (!allowed.includes(String(source[key]))) malformed();
        result[key] = source[key];
    }
    return result;
}
function changed(data: JsonObject): boolean { if (data.changed != null && typeof data.changed !== 'boolean') malformed(); return data.changed === true; }
export function memberResult(name: string, data: JsonObject): JsonObject {
    if (name.startsWith('member-settings-')) {
        const settings = settingObject(data.settings);
        if (name === 'member-settings-get') return { settings };
        if (!Array.isArray(data.changes)) malformed();
        const changes = data.changes.map((value) => {
            const row = object(value), allowed = memberSettings[String(row.field)];
            if (!allowed) malformed();
            const result: JsonObject = { field: row.field };
            for (const key of ['before', 'after']) {
                if (row[key] == null) continue;
                if (!allowed.includes(String(row[key]))) malformed();
                result[key] = row[key];
            }
            return result;
        });
        return { settings, changes, changed: changed(data) };
    }
    if (name === 'member-list') { if (!Array.isArray(data.items)) malformed(); return { items: data.items.map(record) }; }
    const result: JsonObject = { member: record(data.member), changed: changed(data) };
    if (name === 'member-update') {
        if (!roles.includes(String(data.before_role)) || !roles.includes(String(data.after_role))) malformed();
        result.before_role = data.before_role; result.after_role = data.after_role;
    }
    return result;
}

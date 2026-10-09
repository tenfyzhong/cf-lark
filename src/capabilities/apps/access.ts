import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function text(args: JsonObject, key: string) { return typeof args[key] === 'string' ? args[key].trim() : ''; }
export function accessRequest(name: string, args: JsonObject, path: string): ApiRequest {
    path += '/access-scope';
    if (name === 'access-scope-get') return { method: 'GET', path };
    const scope = text(args, 'scope'), raw = text(args, 'targets'), approver = text(args, 'approver');
    const body: JsonObject = {};
    if (scope === 'specific') {
        let targets: unknown; try { targets = JSON.parse(raw); } catch { invalid('targets must be a JSON array.'); }
        if (!Array.isArray(targets) || !targets.length) invalid('Specific scope requires at least one target.');
        for (const item of targets) {
            if (!item || typeof item !== 'object' || Array.isArray(item) || !['user', 'department', 'chat'].includes(item.type) || typeof item.id !== 'string' || !item.id.trim()) invalid('Each target requires user/department/chat type and a nonblank id.');
            const field = { user: 'users', department: 'departments', chat: 'chats' }[item.type as string]!;
            (body[field] as string[] | undefined ?? (body[field] = []) as string[]).push(item.id.trim());
        }
        if (approver && args['apply-enabled'] !== true) invalid('approver requires apply-enabled.');
        if (args['require-login'] === true) invalid('require-login is only valid for public scope.');
        body.scope = 'Range';
        if (args['apply-enabled'] === true) body.apply_config = { enabled: true, ...(approver ? { approvers: [approver] } : {}) };
    } else if (scope === 'public') {
        if (raw || approver || args['apply-enabled'] === true) invalid('Public scope does not accept targets or approval options.');
        if (typeof args['require-login'] !== 'boolean') invalid('Public scope requires explicit require-login.');
        body.scope = 'All'; body.require_login = args['require-login'];
    } else if (scope === 'tenant') {
        if (raw || approver || args['apply-enabled'] === true || args['require-login'] === true) invalid('Tenant scope does not accept additional scope options.');
        body.scope = 'Tenant';
    } else invalid('scope must be specific, public, or tenant.');
    return { method: 'PUT', path, body };
}
const directions: Record<string, number> = { 'miaoda-to-open-id': 10, 'miaoda-to-union-id': 11, 'open-id-to-miaoda': 20, 'union-id-to-miaoda': 21, 'miaoda-to-feishu-user-id': 40 };
export function conversionRequest(args: JsonObject): ApiRequest {
    const type = directions[text(args, 'convert-type')]; if (type == null) invalid('Invalid convert-type.');
    const parts = typeof args.ids === 'string' ? args.ids.replace(/\r\n|\r|\n/g, ',').split(',').map((id) => id.trim()) : [];
    while (parts.length && parts.at(-1) === '') parts.pop();
    if (!parts.length || parts.length > 100 || parts.some((id) => !id)) invalid('ids must contain 1-100 nonblank entries without interior empty positions.');
    return { method: 'POST', path: '/open-apis/spark/v1/directory/user/id_convert', body: { id_convert_type: type, ids: parts } };
}
export function conversionResult(args: JsonObject, request: ApiRequest, data: JsonObject): JsonObject {
    const grouped = new Map<string, string[]>();
    for (const row of Array.isArray(data.items) ? data.items : []) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const id = row.source_id == null ? '' : String(row.source_id); if (!id) continue;
        const group = grouped.get(id) ?? []; group.push(row.target_id == null ? '' : String(row.target_id)); grouped.set(id, group);
    }
    const items: JsonObject[] = [], missed: JsonObject[] = [];
    ((request.body as JsonObject).ids as string[]).forEach((id, index) => {
        const targets = grouped.get(id);
        if (targets?.length) items.push({ index, source_id: id, target_id: targets.shift()! });
        else missed.push({ index, source_id: id, reason: 'not_found' });
    });
    return { convert_type: text(args, 'convert-type'), items, missed };
}

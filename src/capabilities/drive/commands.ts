import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { driveDefinitions } from './definitions';
import { enc, invalid, obj, resource, resourceTypes, str, target } from './helpers';
function prepare(action: string, input: JsonObject, identity = 'user') {
    const args = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
    for (const key of driveDefinitions.find((item) => item.id === `drive.+${action}`)!.inputSchema.required as string[]) if (!str(args[key])) invalid(`${key} is required.`);
    if (action === 'create-folder') {
        if (new TextEncoder().encode(str(args.name)).length > 256) invalid('Folder names must not exceed 256 UTF-8 bytes.');
        if (args['folder-token']) resource(args['folder-token'], 'folder-token');
        return { args, request: { method: 'POST', path: '/open-apis/drive/v1/files/create_folder', body: { name: args.name, folder_token: args['folder-token'] || '' } } as ApiRequest };
    }
    if (action === 'create-shortcut') {
        resource(args['file-token']); resource(args['folder-token']);
        if (!['file', 'docx', 'bitable', 'doc', 'sheet', 'mindnote', 'slides'].includes(str(args.type))) invalid('Unsupported shortcut source type.');
        return { args, request: { method: 'POST', path: '/open-apis/drive/v1/files/create_shortcut', body: { parent_token: args['folder-token'], refer_entity: { refer_token: args['file-token'], refer_type: args.type } } } as ApiRequest };
    }
    if (action === 'secure-label-list') {
        const size = args['page-size'] ?? 10;
        if (!Number.isInteger(size) || Number(size) < 1 || Number(size) > 10) invalid('page-size must be between 1 and 10.');
        if (args.lang && !['en', 'zh', 'ja'].includes(str(args.lang))) invalid('Unsupported label language.');
        return { args, request: { method: 'GET', path: '/open-apis/drive/v2/my_secure_labels', query: { page_size: size, ...(args['page-token'] ? { page_token: args['page-token'] } : {}), ...(args.lang ? { lang: args.lang } : {}) } } as ApiRequest };
    }
    const allowed = action === 'secure-label-update' ? resourceTypes.filter((type) => !['folder', 'minutes', 'apps'].includes(type)) : action === 'apply-permission' ? resourceTypes.filter((type) => !['folder', 'minutes'].includes(type)) : resourceTypes;
    const resolved = target(args.token, args.type, allowed, action !== 'member-add');
    args.token = resolved.token; args.type = resolved.type;
    const path = `/open-apis/drive/v1/permissions/${enc(args.token)}/members`, query: JsonObject = { type: args.type };
    let request: ApiRequest;
    if (action === 'permission-get-setting') request = { method: 'GET', path: `/open-apis/drive/v2/permissions/${enc(args.token)}/public`, query };
    else if (action === 'secure-label-update') {
        if (!/^\d+$/.test(str(args['label-id']))) invalid('label-id must be numeric.');
        request = { method: 'PATCH', path: `/open-apis/drive/v2/files/${enc(args.token)}/secure_label`, query, body: { id: args['label-id'] } };
    } else if (action === 'apply-permission') {
        if (!['view', 'edit'].includes(str(args.perm))) invalid('perm must be view or edit.');
        request = { method: 'POST', path: `${path}/apply`, query, body: { perm: args.perm, ...(args.remark ? { remark: args.remark } : {}) } };
    } else if (action === 'member-list') {
        if (Object.hasOwn(args, 'fields')) {
            const fields = str(args.fields).toLowerCase().split(',').map((value) => value.trim());
            if (fields.some((value) => !['name', 'type', 'avatar', 'external_label', '*'].includes(value)) || (fields.includes('*') && fields.length > 1)) invalid('Invalid collaborator fields.');
            query.fields = [...new Set(fields)].join(',');
        }
        if (Object.hasOwn(args, 'perm-type')) {
            if (args.type !== 'wiki' || !['container', 'single_page'].includes(str(args['perm-type']))) invalid('perm-type requires Wiki and container or single_page.');
            query.perm_type = args['perm-type'];
        }
        request = { method: 'GET', path, query };
    } else {
        const members = str(args['member-id']).split(',').map((id) => id.trim()).filter(Boolean), memberType = str(args['member-type']).toLowerCase();
        if (!members.length || members.length > (action === 'member-add' ? 10 : 1) || new Set(members).size !== members.length) invalid('Member IDs must be unique and within the operation batch limit.');
        const memberTypes = ['email', 'openid', 'unionid', 'openchat', 'opendepartmentid', 'groupid', 'appid', 'wikispaceid', ...(action === 'member-remove' ? ['userid'] : [])];
        if (!memberTypes.includes(memberType)) invalid('Unsupported member-type.');
        for (const id of members) {
            resource(id, 'member-id');
            const inferred = id.includes('@') ? 'email' : ({ ou_: 'openid', on_: 'unionid', oc_: 'openchat', od_: 'opendepartmentid' } as Record<string, string>)[id.slice(0, 3)];
            if (inferred && inferred !== memberType) invalid('member-type conflicts with the member ID prefix.');
        }
        if (identity === 'bot' && (memberType === 'opendepartmentid' || Object.hasOwn(args, 'need-notification'))) invalid('Department permissions and notification flags require user identity.');
        let kind = ({ email: 'user', openid: 'user', unionid: 'user', userid: 'user', openchat: 'chat', opendepartmentid: 'department', groupid: 'group' } as Record<string, string>)[memberType];
        if (memberType === 'wikispaceid') {
            kind = str(args['member-kind']);
            if (!['wiki_space_member', 'wiki_space_viewer', 'wiki_space_editor'].includes(kind)) invalid('Wiki-space collaborators require member-kind.');
        } else if (args['member-kind']) invalid('member-kind is only valid for Wiki-space collaborators.');
        if (Object.hasOwn(args, 'perm-type') && (args.type !== 'wiki' || memberType === 'wikispaceid')) invalid('perm-type is only valid for ordinary Wiki collaborators.');
        const permType = args.type === 'wiki' && memberType !== 'wikispaceid' ? str(args['perm-type']) || 'container' : '';
        if (permType && !['container', 'single_page'].includes(permType)) invalid('Invalid perm-type.');
        const perm = str(args.perm) || 'view';
        if (!['view', 'edit', 'full_access'].includes(perm)) invalid('Invalid permission.');
        Object.assign(args, { members, 'member-type': memberType, kind, perm, 'perm-type': permType });
        const extra = { ...(kind ? { type: kind } : {}), ...(permType ? { perm_type: permType } : {}) };
        if (action === 'member-remove') request = { method: 'DELETE', path: `${path}/${enc(members[0])}`, query: { ...query, member_type: memberType }, body: extra };
        else {
            const bodies = members.map((member_id) => ({ member_id, member_type: memberType, perm, ...extra }));
            request = { method: 'POST', path: `${path}${members.length > 1 ? '/batch_create' : ''}`, query: { ...query, ...(Object.hasOwn(args, 'need-notification') ? { need_notification: args['need-notification'] } : {}) }, body: members.length > 1 ? { members: bodies } : bodies[0] };
        }
    }
    return { args, request };
}
function memberOutput(args: JsonObject, raw: JsonObject, fallback = ''): JsonObject {
    return { resource_token: args.token, resource_type: args.type, ...(raw.member_id || fallback ? { member_id: raw.member_id || fallback } : {}), member_type: raw.member_type || args['member-type'], perm: raw.perm || args.perm, ...(raw.type || args.kind ? { member_kind: raw.type || args.kind } : {}), ...(args['perm-type'] ? { perm_type: raw.perm_type || args['perm-type'] } : {}) };
}
export async function grantCurrentUser(context: CommandContext, token: string, type: string) {
    const profile = context.grant.profiles.find((item) => item.profileId === context.selection.profileId), account = context.selection.accountId || (profile?.accounts.length === 1 ? profile.accounts[0] : undefined);
    let status = 'skipped';
    if (account && profile?.accounts.includes(account)) {
        try { await context.lark.request({ method: 'POST', path: `/open-apis/drive/v1/permissions/${enc(token)}/members`, query: { type, need_notification: false }, body: { member_type: 'openid', member_id: account, perm: 'full_access', type: 'user' } }); status = 'granted'; } catch { status = 'failed'; }
    }
    return { status, perm: 'full_access', ...(account ? { member_id: account } : { reason: 'No unambiguous authorized user account is available.' }) };
}
export function driveCapabilities(): Capability[] {
    return driveDefinitions.map((definition) => {
        const action = definition.id.slice('drive.+'.length);
        return { definition,
            async preview(input, context) { return { requests: [prepare(action, input, context?.selection.identity).request] }; },
            async execute(input, context) {
                const { args, request } = prepare(action, input, context.selection.identity), response = await context.lark.request(request);
                if (action === 'create-folder') {
                    if (!str(response.token)) throw new ServiceError('INVALID_RESPONSE', 'Folder creation returned no token.');
                    return { created: true, name: args.name, folder_token: response.token, parent_folder_token: args['folder-token'] || '', ...(response.url ? { url: response.url } : {}), ...(context.selection.identity === 'bot' ? { permission_grant: await grantCurrentUser(context, str(response.token), 'folder') } : {}) };
                }
                if (action === 'create-shortcut') {
                    const shortcut = obj(response.succ_shortcut_node);
                    return { created: true, source_file_token: args['file-token'], source_type: args.type, folder_token: args['folder-token'], ...(shortcut.token ? { shortcut_token: shortcut.token } : {}), ...(shortcut.url ? { url: shortcut.url } : {}), ...(shortcut.name ? { title: shortcut.name } : {}) };
                }
                if (action === 'member-remove') return { removed: true, resource_token: args.token, resource_type: args.type, member_id: args['member-id'], member_type: args['member-type'], ...(args.kind ? { member_kind: args.kind } : {}), ...(args['perm-type'] ? { perm_type: args['perm-type'] } : {}) };
                if (action === 'member-add') {
                    const ids = args.members as string[];
                    if (ids.length === 1) return memberOutput(args, obj(response.member), ids[0]);
                    const members = (Array.isArray(response.members) ? response.members : []).filter((item) => item && typeof item === 'object').map((item) => memberOutput(args, obj(item)));
                    const succeeded = new Set(members.map((item) => item.member_id).filter((id) => ids.includes(str(id))));
                    const missing = ids.filter((id) => !succeeded.has(id)), mismatched = members.filter((item) => item.member_id && !ids.includes(str(item.member_id))).map((item) => ({ returned: item.member_id }));
                    return { resource_token: args.token, resource_type: args.type, requested_count: ids.length, succeeded_count: succeeded.size, partial: members.length !== ids.length || missing.length > 0 || mismatched.length > 0, members, missing_member_ids: missing, ...(mismatched.length ? { mismatched_member_ids: mismatched } : {}) };
                }
                if (action === 'permission-get-setting') {
                    if (!response.permission_public || typeof response.permission_public !== 'object') throw new ServiceError('INVALID_RESPONSE', 'Permission response omitted permission_public.');
                    return { permission_public: response.permission_public };
                }
                return response;
            },
        };
    });
}

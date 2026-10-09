import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string' };
const nonblank = { type: 'string', minLength: 1 };
const environment = { type: 'string', enum: ['dev', 'online'] };
const app = { 'app-id': nonblank };
const yes = { type: 'boolean' };
const appType = { type: 'string', enum: ['html', 'frontend', 'full_stack'] };
const specifications: [string, boolean, string[], JsonObject][] = [
    ['list', false, [], { keyword: text, ownership: { type: 'string', enum: ['all', 'mine', 'shared'] }, 'app-type': appType, 'page-size': { type: 'integer', default: 20 }, 'page-token': text }],
    ['get', false, ['app-id'], app],
    ['create', true, ['name', 'app-type'], { name: nonblank, 'app-type': appType, description: text, 'icon-url': text }],
    ['update', true, ['app-id'], { ...app, name: text, description: text }],
    ['cache-get', false, ['app-id', 'key'], { ...app, key: nonblank, environment }],
    ['cache-delete', true, ['app-id', 'key'], { ...app, key: nonblank, environment }],
    ['cache-clear', true, ['app-id'], { ...app, environment, yes }],
    ['html-publish', true, ['app-id', 'path'], { ...app, path: nonblank, name: text, 'allow-sensitive': yes }],
    ['env-pull', true, ['app-id'], { ...app, file: text, 'project-path': { type: 'string', description: 'Local project discovery is unavailable; use an existing dotenv file artifact instead.' } }],
    ['env-list', false, ['app-id'], { ...app, environment, 'include-values': { type: 'boolean' } }],
    ['env-set', true, ['app-id', 'key', 'value'], { ...app, environment, key: nonblank, value: nonblank, yes }],
    ['env-delete', true, ['app-id', 'key'], { ...app, environment, key: { type: 'array', items: nonblank, minItems: 1 }, yes }],
];
specifications.push(
    ['db-data-export', false, ['app-id', 'table'], { ...app, table: nonblank, output: text, limit: { type: 'integer', minimum: 1, maximum: 5000, default: 5000 }, environment }],
    ['db-data-import', true, ['app-id', 'file'], { ...app, file: nonblank, name: text, table: text, environment, yes }],
    ['db-sync-create', true, ['app-id', 'config'], { ...app, config: nonblank, preview: yes, output: text, environment, yes }],
    ['db-sync-update', true, ['app-id', 'task-id', 'config'], { ...app, config: nonblank, 'task-id': nonblank, environment, yes }],
    ['db-execute', true, ['app-id'], { ...app, sql: text, file: text, environment, yes }],
    ['db-env-diff', false, ['app-id'], app],
    ['db-env-migrate', true, ['app-id'], { ...app, yes }],
    ['db-recovery-diff', false, ['app-id', 'target'], { ...app, target: nonblank, environment }],
    ['db-recovery-apply', true, ['app-id', 'target'], { ...app, target: nonblank, environment, yes }],
);
specifications.push(
    ['db-audit-enable', true, ['app-id', 'table'], { ...app, table: nonblank, retention: { type: 'string', enum: ['7d', '30d', '180d', '360d', 'forever'], default: '7d' }, environment }],
    ['db-audit-disable', true, ['app-id', 'table'], { ...app, table: nonblank, environment }],
    ['db-audit-list', false, ['app-id', 'table'], { ...app, table: { type: 'array', items: nonblank, minItems: 1 }, since: text, until: text, 'page-size': { type: 'integer', default: 20 }, 'page-token': text, environment }],
    ['db-changelog-list', false, ['app-id'], { ...app, table: text, 'change-id': text, since: text, until: text, 'page-size': { type: 'integer', default: 20 }, 'page-token': text, environment }],
);
const page = { 'page-size': { type: 'integer', default: 20 }, 'page-token': text };
specifications.push(
    ['session-list', false, ['app-id'], { ...app, ...page }],
    ['session-create', true, ['app-id'], app],
    ['session-get', false, ['app-id', 'session-id'], { ...app, 'session-id': nonblank }],
    ['session-stop', true, ['app-id', 'session-id', 'turn-id'], { ...app, 'session-id': nonblank, 'turn-id': nonblank }],
    ['session-messages-list', false, ['app-id', 'session-id', 'turn-id'], { ...app, 'session-id': nonblank, 'turn-id': nonblank, 'page-token': text }],
    ['chat', true, ['app-id', 'session-id', 'message'], { ...app, 'session-id': nonblank, message: nonblank }],
    ['release-list', false, ['app-id'], { ...app, ...page, status: { type: 'string', enum: ['publishing', 'finished', 'failed'] } }],
    ['release-create', true, ['app-id'], { ...app, branch: text, 'apply-reason': text }],
    ['release-get', false, ['app-id', 'release-id'], { ...app, 'release-id': nonblank }],
);
specifications.push(
    ['db-table-list', false, ['app-id'], { ...app, ...page, environment }],
    ['db-table-get', false, ['app-id', 'table'], { ...app, table: nonblank, environment }],
    ['db-audit-status', false, ['app-id'], { ...app, table: text, environment }],
    ['db-quota-get', false, ['app-id'], { ...app, environment }],
    ['db-env-create', true, ['app-id'], { ...app, environment: { type: 'string', enum: ['dev'], default: 'dev' }, 'sync-data': yes, yes }],
    ['db-sync-list', false, ['app-id'], { ...app, ...page, environment, mode: { type: 'string', enum: ['batch', 'streaming'] }, status: text, table: text }],
);
for (const action of ['get', 'enable', 'disable', 'delete']) specifications.push([`db-sync-${action}`, action !== 'get', ['app-id', 'task-id'], { ...app, 'task-id': nonblank, ...(action === 'delete' ? { yes } : {}) }]);
const role = { type: 'string', enum: ['view', 'edit', 'full_access'] };
const member = { ...app, 'member-type': { type: 'string', enum: ['openid', 'openchat', 'opendepartmentid'] }, 'member-id': nonblank };
specifications.push(
    ['member-list', false, ['app-id'], { ...app, role, 'member-type': { type: 'string', enum: ['user', 'department', 'chat'] } }],
    ['member-add', true, ['app-id', 'member-type', 'member-id', 'perm'], { ...member, perm: role, 'need-notification': yes }],
    ['member-update', true, ['app-id', 'member-type', 'member-id', 'perm'], { ...member, perm: role }],
    ['member-remove', true, ['app-id', 'member-type', 'member-id'], { ...member, yes }],
    ['member-settings-get', false, ['app-id'], app],
    ['member-settings-set', true, ['app-id'], { ...app, 'external-access': { type: 'string', enum: ['enabled', 'disabled'] }, 'link-share': { type: 'string', enum: ['closed', 'tenant-readable', 'tenant-editable', 'anyone-readable'] }, 'manage-collaborators-by': { type: 'string', enum: ['anyone', 'same-tenant', 'full-access'] }, 'comment-by': { type: 'string', enum: ['viewer', 'editor'] } }],
);
specifications.push(
    ['file-list', false, ['app-id'], { ...app, ...page, name: text, path: text, type: text, 'size-gt': { type: 'integer' }, 'size-lt': { type: 'integer' }, 'uploaded-since': text, 'uploaded-until': text }],
    ['file-get', false, ['app-id', 'path'], { ...app, path: nonblank }],
    ['file-sign', false, ['app-id', 'path'], { ...app, path: nonblank, 'expires-in': { type: 'integer', default: 86400, maximum: 2592000 } }],
    ['file-delete', true, ['app-id', 'path'], { ...app, path: { type: 'array', items: nonblank, minItems: 1 }, yes }],
    ['file-quota-get', false, ['app-id'], app],
);
specifications.push(
    ['access-scope-get', false, ['app-id'], app],
    ['access-scope-set', true, ['app-id', 'scope'], { ...app, scope: { type: 'string', enum: ['specific', 'public', 'tenant'] }, targets: text, 'apply-enabled': yes, approver: text, 'require-login': yes }],
    ['user-id-convert', false, ['convert-type', 'ids'], { 'convert-type': { type: 'string', enum: ['miaoda-to-open-id', 'miaoda-to-union-id', 'open-id-to-miaoda', 'union-id-to-miaoda', 'miaoda-to-feishu-user-id'] }, ids: nonblank }],
);
const conditions = { 'trigger-type': text, description: text, cron: text, timezone: text, table: text, event: text, fields: text, 'white-ip-list': text, 'approval-code': text, 'event-type': text, 'instance-status': { type: 'array', items: text }, 'task-status': { type: 'array', items: text } };
specifications.push(
    ['automation-list', false, ['app-id'], { ...app, 'trigger-type': text, 'page-size': { type: 'integer' }, 'page-token': text, all: yes }],
    ['automation-create', true, ['app-id', 'name', 'trigger-type'], { ...app, name: nonblank, ...conditions, status: text }],
    ['automation-update', true, ['app-id', 'name'], { ...app, name: nonblank, ...conditions, 'reset-url': yes, 'app-env': text, 'enable-token': yes, 'disable-token': yes, 'reset-token': yes, yes }],
);
for (const action of ['get', 'enable', 'disable']) specifications.push([`automation-${action}`, action !== 'get', ['app-id', 'name'], { ...app, name: nonblank }]);
specifications.push(
    ['file-upload', true, ['app-id', 'file'], { ...app, file: nonblank, name: text, 'content-type': text }],
    ['file-download', false, ['app-id', 'path'], { ...app, path: nonblank, output: text }],
    ['export', false, [], { ...app, 'meta-token': nonblank, output: text }],
);
const roleTarget = { ...app, 'role-id': nonblank };
specifications.push(
    ['role-list', false, ['app-id'], { ...app, ...page, name: text }],
    ['role-get', false, ['app-id', 'role-id'], roleTarget],
    ['role-create', true, ['app-id', 'name'], { ...roleTarget, name: nonblank, description: text }],
    ['role-update', true, ['app-id', 'role-id'], { ...roleTarget, name: text, description: text }],
    ['role-delete', true, ['app-id', 'role-id'], { ...roleTarget, yes }],
    ['role-member-list', false, ['app-id', 'role-id'], { ...roleTarget, 'member-type': { type: 'string', enum: ['user', 'department', 'chat'] } }],
    ['role-member-add', true, ['app-id', 'role-id'], { ...roleTarget, users: text, departments: text, chats: text }],
    ['role-member-remove', true, ['app-id', 'role-id'], { ...roleTarget, users: text, departments: text, chats: text, all: yes, yes }],
    ['role-match-list', false, ['app-id', 'user-id'], { ...app, 'user-id': nonblank }],
);
const observe = { ...app, environment: { type: 'string', enum: ['online'], default: 'online' } };
const observePage = { 'page-size': { type: 'integer', minimum: 1, maximum: 100, default: 50 }, 'page-token': text };
const range = { since: text, until: text }, repeated = { type: 'array', items: text };
specifications.push(
    ['log-list', false, ['app-id'], { ...observe, ...observePage, ...range, level: repeated, 'trace-id': repeated, keyword: text, module: text, 'user-id': text, page: text, api: text, 'min-duration': { type: 'integer', minimum: 0 }, 'max-duration': { type: 'integer', minimum: 0 } }],
    ['log-get', false, ['app-id', 'log-id'], { ...observe, 'log-id': nonblank }],
    ['trace-list', false, ['app-id'], { ...observe, ...observePage, ...range, 'trace-id': repeated, 'root-span': text, 'user-id': text }],
    ['trace-get', false, ['app-id', 'trace-id'], { ...observe, 'trace-id': nonblank }],
    ['metric-list', false, ['app-id', 'metric'], { ...observe, ...range, metric: { type: 'string', enum: ['requests', 'latency', 'cpu', 'memory'] }, series: text, page: repeated, api: repeated, 'down-sample': { type: 'string', enum: ['1m', '1h', '1d'] } }],
    ['analytics-list', false, ['app-id', 'analytics'], { ...observe, ...range, analytics: { type: 'string', enum: ['users', 'page-view'] }, series: text, page: text, 'device-type': { type: 'string', enum: ['desktop', 'mobile'] }, granularity: { type: 'string', enum: ['day', 'week', 'month'], default: 'day' } }],
);
const keyFields = { name: text, 'scope-all': yes, 'scope-api': { type: 'array', items: text }, scope: text, 'allow-preview': yes };
for (const action of ['list', 'get', 'create', 'update', 'reset', 'delete', 'enable', 'disable']) {
    const required = ['app-id', ...(!['list', 'create'].includes(action) ? ['key-id'] : []), ...(action === 'create' ? ['name'] : [])];
    const properties = { ...app, ...(!['list', 'create'].includes(action) ? { 'key-id': nonblank } : {}),
        ...(action === 'list' ? { limit: { type: 'integer' }, offset: { type: 'integer' } } : {}),
        ...(['create', 'update'].includes(action) ? keyFields : {}), ...(['reset', 'delete'].includes(action) ? { yes } : {}) };
    specifications.push([`openapi-key-${action}`, !['get', 'list'].includes(action), required, properties]);
}
const legacyEnvironmentCommands = new Set(['db-audit-disable', 'db-audit-enable', 'db-audit-list', 'db-audit-status', 'db-changelog-list', 'db-data-export', 'db-data-import', 'db-env-create', 'db-execute', 'db-quota-get', 'db-recovery-apply', 'db-recovery-diff', 'db-sync-create', 'db-sync-list', 'db-sync-update', 'db-table-get', 'db-table-list']);
for (const [name, , , properties] of specifications) if (legacyEnvironmentCommands.has(name)) properties.env = { type: 'string', description: 'Removed upstream flag; explicitly rejected. Use environment.' };
export const appsDefinitions: CommandDefinition[] = specifications.map(([name, write, required, properties]) => ({
    id: `apps.+${name}`, domain: 'apps', source: 'shortcut', risk: write ? 'write' : 'read', identities: name === 'user-id-convert' ? ['user', 'bot'] : ['user'],
    scopes: name === 'html-publish' ? ['spark:app:write', 'spark:app:read'] : name === 'env-pull' ? ['spark:app:read'] : name === 'user-id-convert' ? ['spark:directory.user.id_convert:read'] : [`spark:app:${write || ['db-env-diff', 'db-recovery-diff'].includes(name) ? 'write' : 'read'}`], description: `Miaoda app ${name.replaceAll('-', ' ')}. Uses the selected user account. Destructive operations require explicit yes=true. ${['file-upload', 'file-download', 'export', 'html-publish', 'env-pull', 'db-data-import', 'db-data-export', 'db-env-migrate', 'db-recovery-diff', 'db-recovery-apply', 'db-audit-list', 'db-audit-enable', 'db-audit-disable', 'db-execute', 'db-sync-create', 'automation-list', 'role-list'].includes(name) ? 'May return workflowId and pending status; invoke workflow.resume with that id until completed. ' : ''}${name === 'html-publish' ? 'path is a private tar.gz USTAR artifact, or an HTML artifact with name=index.html. ' : ''}${name === 'env-pull' ? 'Requires explicit app-id; optional file is an existing dotenv artifact. Returns a private dotenv artifact, not secret values. ' : ''}${['file-upload', 'db-data-import', 'db-execute'].includes(name) ? 'file is a private artifact ID, never a local path. ' : ''}${['file-upload', 'db-data-import'].includes(name) ? 'Use name for the original filename. ' : ''}${name === 'export' || name === 'file-download' || name === 'db-data-export' ? 'Downloads return a private output artifact ID. ' : ''}`,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
}));

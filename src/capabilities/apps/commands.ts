import { observabilityNames, observabilityRequest, observabilityExecute } from './observability';
import { htmlPreview } from './html';
import { envPullRequest } from './env-pull';
import { syncRequest } from './sync';
import { databaseFilePreview } from './db-files';
import { auditNames, auditRequest, auditResult } from './audit';
import { sqlRequest, sqlResult } from './sql';
import { databaseWorkflowNames, databaseJobRequest, migrationDiff } from './db-workflows';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowRunner } from '../../ports/workflows';
import { roleRequest, roleExecute } from './roles';
import { transferPreview } from './transfers';
import { automationRequest, automationResult } from './automation';
import { accessRequest, conversionRequest, conversionResult } from './access';
import { fileRequest, fileResult } from './files';
import { memberRequest, memberResult } from './members';
import { databaseRequest, databaseResult } from './database';
import { sessionRequest, sessionResult } from './sessions';
import { keyRequest, keyResult } from './keys';
import { appsDefinitions } from './definitions';

const base = '/open-apis/spark/v1/apps';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function string(args: JsonObject, key: string) { return typeof args[key] === 'string' ? args[key].trim() : ''; }
function required(args: JsonObject, key: string) { const value = string(args, key); if (!value) invalid(`${key} must not be blank.`); return value; }
function fields(args: JsonObject, names: string[]) {
    return Object.fromEntries(names.map((key) => [key.replaceAll('-', '_'), string(args, key)]).filter(([, value]) => value));
}
function numeric(value: unknown): number | null {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const number = Number(value); return Number.isFinite(number) ? Math.trunc(number) : null;
}
function prepare(name: string, args: JsonObject, preview: boolean): ApiRequest {
    if (observabilityNames.includes(name)) return observabilityRequest(name, args);
    if (name === 'env-pull') return envPullRequest(args);
    if (['db-sync-create', 'db-sync-update'].includes(name)) return syncRequest(name, args, preview);
    if (auditNames.includes(name)) return auditRequest(name, args);
    if (name === 'db-execute') return sqlRequest(args, preview);
    if (name === 'env-pull' || databaseWorkflowNames.includes(name) || name === 'db-env-diff') return databaseJobRequest(name, args, preview);
    if (name === 'user-id-convert') return conversionRequest(args);
    const path = ['list', 'create'].includes(name) ? base : `${base}/${encodeURIComponent(required(args, 'app-id'))}`;
    if (name.startsWith('role-')) return roleRequest(name.slice(5), args, path, preview);
    if (name.startsWith('automation-')) return automationRequest(name.slice(11), args, path, preview);
    if (name.startsWith('access-scope-')) return accessRequest(name, args, path);
    if (name.startsWith('file-')) return fileRequest(name, args, path, preview);
    if (name.startsWith('member-')) return memberRequest(name, args, path, preview);
    if (name.startsWith('db-')) return databaseRequest(name, args, path, preview);
    if (name.startsWith('session-') || name.startsWith('release-') || name === 'chat') return sessionRequest(name, args, path);
    if (name.startsWith('openapi-key-')) return keyRequest(name.slice(12), args, path, preview);
    const env = string(args, 'environment');
    if (env && !['dev', 'online'].includes(env)) invalid('environment must be dev or online.');
    if (name === 'list') return { method: 'GET', path, query: { page_size: args['page-size'] ?? 20, ...fields(args, ['keyword', 'ownership', 'app-type', 'page-token']) } };
    if (name === 'get') return { method: 'GET', path };
    if (name === 'create') {
        const name = required(args, 'name');
        if (!['html', 'frontend', 'full_stack'].includes(string(args, 'app-type'))) invalid('app-type must be html, frontend, or full_stack.');
        return { method: 'POST', path, body: { name, app_type: args['app-type'], ...fields(args, ['description', 'icon-url']) } };
    }
    if (name === 'update') {
        const body = fields(args, ['name', 'description']);
        if (!Object.keys(body).length) invalid('Provide a nonblank name or description.');
        return { method: 'PATCH', path, body };
    }
    if (name.startsWith('cache-')) {
        const values = { ...(env ? { env } : {}), ...(name === 'cache-clear' ? {} : { key: required(args, 'key') }) };
        if (name === 'cache-clear') {
            confirm(args, preview);
            return { method: 'POST', path: `${path}/cache/clear`, body: values };
        }
        return { method: name === 'cache-get' ? 'GET' : 'DELETE', path: `${path}/cache`, query: values };
    }
    if (name === 'env-list') return { method: 'POST', path: `${path}/env_vars`, body: { env: env || 'dev', scene: 2 } };
    if (name === 'env-set') {
        const key = required(args, 'key'); validateKey(key);
        if (typeof args.value !== 'string' || args.value === '') invalid('value must not be empty.');
        if (env === 'online') confirm(args, preview);
        return { method: 'POST', path: `${path}/create_or_update_env_var`, body: { key, env: env || 'dev', value: preview ? '<redacted>' : args.value } };
    }
    if (!Array.isArray(args.key)) invalid('key must be an array.');
    const keys = [...new Set(args.key.filter((value) => typeof value === 'string').map((value: string) => value.trim()).filter(Boolean))];
    if (!keys.length) invalid('Provide at least one key.');
    keys.forEach(validateKey); confirm(args, preview);
    return { method: 'POST', path: `${path}/delete_env_vars`, body: { env: env || 'dev', keys } };
}
function validateKey(key: string) { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) invalid('Environment key must match [A-Za-z_][A-Za-z0-9_]*.'); }
function confirm(args: JsonObject, preview: boolean) {
    if (!preview && args.yes !== true) throw new ServiceError('CONFIRMATION_REQUIRED', 'Explicit yes=true is required for this mutation.');
}
function project(name: string, args: JsonObject, request: ApiRequest, data: JsonObject): JsonObject {
    if (name === 'db-changelog-list') return auditResult(name, data);
    if (name === 'db-env-diff') return migrationDiff(data);
    if (name.startsWith('automation-')) return automationResult(name.slice(11), args, data);
    if (name === 'user-id-convert') return conversionResult(args, request, data);
    if (name.startsWith('file-')) return fileResult(name, request, data);
    if (name.startsWith('member-')) return memberResult(name, data);
    if (name.startsWith('db-')) return databaseResult(name, args, data);
    if (name.startsWith('session-') || name.startsWith('release-') || name === 'chat') return sessionResult(name, data);
    if (name.startsWith('openapi-key-')) return keyResult(name.slice(12), args, data);
    if (name === 'list') return { ...data, items: (Array.isArray(data.items) ? data.items : []).map((item: any) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        const { icon_url: _icon, created_at: _created, ...rest } = item; return rest;
    }) };
    if (name.startsWith('cache-')) {
        const out: JsonObject = { environment: typeof data.env === 'string' && data.env ? data.env : string(args, 'environment') };
        if (name !== 'cache-clear') out.key = args.key;
        if (name !== 'cache-get') return { ...out, deleted_key_count: numeric(data.deleted_key_count) };
        const exists = data.exists === true || typeof data.exists === 'string' && data.exists.trim().toLowerCase() === 'true';
        const value = typeof data.value === 'string' ? data.value : '';
        return { ...out, exists, ttl_ms: exists ? numeric(data.ttl_ms) : null, value_size_bytes: exists ? new TextEncoder().encode(value).length : null, ...(exists ? { value } : {}) };
    }
    if (name === 'env-set') return { key: (request.body as JsonObject).key, env: (request.body as JsonObject).env, action: typeof data.action === 'string' && data.action || 'set' };
    if (name === 'env-delete') {
        const keys = data.deleted_keys ?? data.deletedKeys;
        return { env: (request.body as JsonObject).env, deleted_keys: Array.isArray(keys) && keys.length ? keys.filter((key) => typeof key === 'string') : (request.body as JsonObject).keys };
    }
    if (name === 'env-list') {
        const source = data.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data as JsonObject : data;
        const raw = source.env_vars ?? source.envVars ?? source.items;
        const include = args['include-values'] === true;
        const items = Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => {
            if (include) return item;
            const { value: _value, ...rest } = item; return rest;
        }) : raw && typeof raw === 'object' ? Object.keys(raw).sort().map((key) => ({ key, ...(include ? { value: (raw as JsonObject)[key] } : {}) })) : [];
        return { items, page_token: source.page_token ?? source.next_page_token ?? source.nextPageToken ?? '', has_more: source.has_more ?? source.hasMore ?? false };
    }
    return data;
}
export function appsCapabilities(runner?: WorkflowRunner): Capability[] {
    return appsDefinitions.map((definition) => {
        const name = definition.id.slice('apps.+'.length);
        return { definition,
            preview: async (args) => name === 'html-publish' ? htmlPreview(args) : name.startsWith('db-data-') ? databaseFilePreview(name, args) : ['file-upload', 'file-download', 'export'].includes(name) ? transferPreview(name, args) : ({ requests: [prepare(name, args, true)] }),
            execute: async (args, context) => {
                if (name === 'html-publish') {
                    htmlPreview(args);
                    if (!runner) throw new ServiceError('WORKFLOW_UNAVAILABLE', 'The workflow runner is unavailable.', 503);
                    return runner.start('apps-html-publish', { args, phase: 'prepare' }, context.selection, context.grant);
                }
                if (['file-upload', 'file-download', 'export', 'db-data-export', 'db-data-import'].includes(name)) {
                    if (name.startsWith('db-data-')) { databaseFilePreview(name, args); if (name === 'db-data-import' && args.yes !== true) throw new ServiceError('CONFIRMATION_REQUIRED', 'Explicit yes=true is required.'); } else transferPreview(name, args);
                    if (!runner) throw new ServiceError('WORKFLOW_UNAVAILABLE', 'The workflow runner is unavailable.', 503);
                    return runner.start(`apps-${name}`, { args, phase: 'prepare' }, context.selection, context.grant);
                }
                const request = prepare(name, args, false);
                if (observabilityNames.includes(name)) return observabilityExecute(name, args, request, context.lark);
                if (auditNames.includes(name) && name !== 'db-changelog-list') {
                    if (!runner) throw new ServiceError('WORKFLOW_UNAVAILABLE', 'The workflow runner is unavailable.', 503);
                    return runner.start(`apps-${name}`, { args, phase: 'schema' }, context.selection, context.grant);
                }
                if (name === 'env-pull' || databaseWorkflowNames.includes(name) || name === 'db-execute' && args.file || name === 'db-sync-create' && args.preview === true && args.output) {
                    if (!runner) throw new ServiceError('WORKFLOW_UNAVAILABLE', 'The workflow runner is unavailable.', 503);
                    return runner.start(`apps-${name}`, { args, phase: 'prepare' }, context.selection, context.grant);
                }
                if (name === 'role-list' && args.name) {
                    if (!runner) throw new ServiceError('WORKFLOW_UNAVAILABLE', 'The workflow runner is unavailable.', 503);
                    return runner.start('apps-role-list', { args, page: 0, seen: [], matches: [], scanned: 0 }, context.selection, context.grant);
                }
                if (name.startsWith('role-')) return roleExecute(name.slice(5), args, request, context.lark);
                if (name === 'automation-list' && args.all === true) {
                    if (!runner) throw new ServiceError('WORKFLOW_UNAVAILABLE', 'The workflow runner is unavailable.', 503);
                    return runner.start('apps-automation-list', { args, items: [], pages: 0, seen: [] }, context.selection, context.grant);
                }
                const data = await context.lark.request(request);
                return name === 'db-execute' ? sqlResult(data) : project(name, args, request, data);
            },
        };
    });
}

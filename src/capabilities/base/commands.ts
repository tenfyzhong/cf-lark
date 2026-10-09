import { recordReadCapabilities } from './record-read';
import type { BaseRecordFormatter } from './record-export';
import { attachmentCapabilities } from './attachments';
import { blockCapabilities } from './blocks';
import { workflowWriteCapabilities } from './workflow-write';
import { recordActionCapabilities } from './record-actions';
import { copyCapabilities } from './copy';
import { discoveryCapabilities } from './discovery';
import { questionCapabilities } from './questions';
import { fieldCapabilities } from './fields';
import { withArtifactInputs } from './artifact-input';
import type { ArtifactStore, ArtifactFiles } from '../../ports/artifacts';
import { dashboardCapabilities } from './dashboard';
import { formCapabilities } from './forms';
import { programCapabilities } from './programs';
import type { WorkflowRunner } from '../../ports/workflows';
import { appCapabilities } from './app';
import { directoryCapabilities } from './directory';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { coreDefinitions } from './definitions';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function object(value: unknown): value is JsonObject { return !!value && typeof value === 'object' && !Array.isArray(value); }
function prepare(name: string, args: JsonObject) {
    const definition = coreDefinitions.find(item => item.id === `base.+${name}`)!;
    for (const key of definition.inputSchema.required as string[]) if (key !== 'json' && (typeof args[key] !== 'string' || !args[key].trim())) invalid(`${key} is required.`);
    const [family, action, ...propertyParts] = name.split('-');
    const property = propertyParts.join('_');
    if (['role', 'advperm', 'workflow'].includes(family!)) {
        const prefix = `/open-apis/base/v3/bases/${encodeURIComponent(String(args['base-token']))}`;
        let request: ApiRequest;
        if (family === 'advperm') request = { method: 'PUT', path: `${prefix}/advperm/enable`, query: { enable: action === 'enable' ? 'true' : 'false' } };
        else if (family === 'workflow') {
            request = { method: action === 'get' ? 'GET' : 'PATCH', path: `${prefix}/workflows/${encodeURIComponent(String(args['workflow-id']))}${action === 'get' ? '' : `/${action}`}` };
            if (action !== 'get') request.body = {};
            else if (args['user-id-type']) {
                if (!['open_id', 'union_id', 'user_id'].includes(String(args['user-id-type']))) invalid('Invalid user-id-type.');
                request.query = { user_id_type: args['user-id-type'] };
            }
        } else {
            request = { method: action === 'create' ? 'POST' : action === 'update' ? 'PUT' : action === 'delete' ? 'DELETE' : 'GET', path: `${prefix}/roles${['list', 'create'].includes(action!) ? '' : `/${encodeURIComponent(String(args['role-id']))}`}` };
            if (action === 'delete') request.body = {};
            if (action === 'create' || action === 'update') request.body = parseObject(args.json);
        }
        return { request, family: family!, action, property };
    }
    const segments = ['bases', args['base-token'], 'tables'];
    if (family !== 'table' || action !== 'list') segments.push(args['table-id']);
    if (family !== 'table') {
        segments.push(`${family}s`);
        if (action !== 'list') segments.push(args[`${family}-id`]);
    }
    if (property && action !== 'search') segments.push(property);
    if (action === 'search') segments.push('options');
    const request: ApiRequest = { method: action === 'delete' ? 'DELETE' : action === 'set' ? 'PUT' : action === 'rename' || action === 'update' ? 'PATCH' : 'GET', path: `/open-apis/base/v3/${segments.map(segment => encodeURIComponent(String(segment))).join('/')}` };
    if (action === 'list' || action === 'search') {
        const limit = args.limit ?? args['page-size'] ?? (action === 'search' ? 30 : family === 'view' ? 100 : 300);
        if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > (action === 'list' && family !== 'view' ? 300 : 200)) invalid('Invalid pagination size.');
        const offset = args.offset ?? 0;
        if (typeof offset !== 'number' || !Number.isInteger(offset)) invalid('offset must be an integer.');
        request.query = { offset: action === 'search' ? offset : Math.max(0, offset), limit };
        if (action === 'search' && String(args.keyword ?? '').trim()) request.query.query = String(args.keyword).trim();
    }
    if (action === 'set') {
        let value = args.json;
        if (typeof value === 'string') { try { value = JSON.parse(value); } catch { invalid('json must contain a JSON object.'); } }
        if (!object(value)) invalid('json must contain a JSON object.');
        request.body = value;
    }
    if (action === 'rename' || action === 'update') request.body = { name: args.name };
    return { request, family: family!, action, property };
}
export function baseCapabilities(dependencies: { workflows?: WorkflowRunner; artifacts?: ArtifactStore; recordFormatter?: BaseRecordFormatter } = {}): Capability[] {
    return [...coreDefinitions.map((definition): Capability => {
        const name = definition.id.slice('base.+'.length);
        return { definition,
            preview: async args => ({ requests: [prepare(name, args).request] }),
            execute: async (args, context) => {
                const { request, family, action, property } = prepare(name, args);
                const data = await context.lark.request(request);
                if (family === 'role' || family === 'advperm') return roleResponse(data);
                if (family === 'workflow') return data;
                if (action === 'list') {
                    const raw = data[`${family}s`];
                    let items: unknown[] = Array.isArray(raw) ? raw : [];
                    if (family === 'table' && !items.length) items = Array.isArray(data.items) ? data.items : data.id !== undefined ? [data] : [];
                    items = items.filter(object);
                    return { [`${family}s`]: items, total: Number(data.total) || items.length };
                }
                if (action === 'search') {
                    const options = Array.isArray(data.options) ? data.options : [];
                    return { field_id: args['field-id'], field_name: args['field-id'], keyword: String(args.keyword ?? '').trim(), options, total: Number(data.total) || options.length };
                }
                if (action === 'delete') return { deleted: true, [`${family}_id`]: args[`${family}-id`], [`${family}_name`]: args[`${family}-id`] };
                return { [property || family]: data, ...(action === 'update' ? { updated: true } : {}) };
            },
        };
    }), ...directoryCapabilities(), ...appCapabilities(), ...programCapabilities(dependencies.workflows), ...formCapabilities(), ...dashboardCapabilities(), ...fieldCapabilities(), ...questionCapabilities(), ...discoveryCapabilities(), ...copyCapabilities(), ...recordActionCapabilities(), ...recordReadCapabilities({ workflows: dependencies.workflows, recordFormatter: dependencies.recordFormatter, artifacts: dependencies.artifacts && 'stat' in dependencies.artifacts ? dependencies.artifacts as ArtifactFiles : undefined }), ...attachmentCapabilities(dependencies.workflows), ...blockCapabilities(dependencies.workflows), ...workflowWriteCapabilities()].map(capability => withArtifactInputs(capability, dependencies.artifacts));
}

function parseObject(value: unknown): JsonObject {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { invalid('json must contain a JSON object.'); } }
    if (!object(value)) invalid('json must contain a JSON object.');
    return value;
}
function decoded(value: unknown): unknown {
    if (typeof value !== 'string' || !value) return value;
    try { return JSON.parse(value); } catch { return value; }
}
function roleResponse(value: unknown): unknown {
    if (value === null || value === undefined || value === '') return { success: true };
    value = decoded(value);
    if (object(value) && Object.hasOwn(value, 'code')) {
        const code = typeof value.code === 'number' ? Math.trunc(value.code) : 0;
        if (code !== 0) throw new ServiceError('UPSTREAM_ERROR', 'The Base role operation failed.', 502, { upstreamCode: code });
        return Object.hasOwn(value, 'data') ? decoded(value.data) : { success: true };
    }
    return value;
}

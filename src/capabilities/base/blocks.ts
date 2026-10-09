import type { JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
import type { Capability } from '../../ports/capabilities';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { ServiceError } from '../../domain/errors';
import { blockDefinitions } from './block-definitions';
import { appConfig, appPatch, charts, dashboardConfig, filter, invalid, normalize, normalizeApp, numberFormat, object, parse } from './block-config';
const str = (args: JsonObject, key: string) => typeof args[key] === 'string' ? args[key].trim() : '';
const present = (args: JsonObject, key: string) => args[key] !== undefined && args[key] !== '';
const path = (...parts: unknown[]) => `/open-apis/base/v3/${parts.map(p => encodeURIComponent(String(p))).join('/')}`;
const subtype = (value: unknown) => { const result = String(value ?? '').trim().toLowerCase() || 'standard'; if (!['standard', 'grouped', 'collapsible', 'card', 'detail'].includes(result)) invalid('Invalid list sub-type.'); return result; };
function prepare(name: string, args: JsonObject): JsonObject {
    const definition = blockDefinitions.find(d => d.id === `base.+${name}`)!;
    for (const key of definition.inputSchema.required as string[]) if (!str(args, key)) invalid(`${key} is required.`);
    const app = name.startsWith('app'), create = name.endsWith('create'), skip = args['no-validate'] === true;
    const body: JsonObject = {};
    if (str(args, 'name')) body.name = str(args, 'name');
    const type = str(args, 'type'), kind = type.toLowerCase();
    if (create) body.type = kind === 'nps' ? 'nps' : type;
    if (app && create) {
        if (![...charts, 'text', 'list'].some(value => value.toLowerCase() === kind)) invalid('Unsupported app block type.');
        if (kind === 'list') body.sub_type = subtype(args['sub-type']);
        else if (str(args, 'sub-type')) invalid('sub-type is supported only for lists.');
    }
    if (present(args, 'data-config')) {
        let cfg = parse(args['data-config'], 'data-config');
        if (!skip) {
            if (!app) cfg = create ? dashboardConfig(type, cfg) : normalize(cfg);
            else if (!create) cfg = appPatch(cfg);
            else { cfg = kind === 'list' ? cfg : charts.some(c => c.toLowerCase() === kind) ? normalizeApp(cfg) : normalize(cfg); appConfig(type, String(body.sub_type ?? ''), cfg); }
            if (!app && !create) { filter(cfg, false, true); numberFormat(cfg); }
        }
        body.data_config = cfg;
    } else if (create && (app ? kind !== 'text' : !skip && ['text', 'nps', 'ranking'].includes(kind))) invalid(`${type} requires data-config.`);
    if (app && !create && !('name' in body) && !('data_config' in body)) invalid('Provide name or data-config.');
    if (!app && present(args, 'position')) {
        const position = parse(args.position, 'position');
        if (!skip) for (const key of ['x', 'y', 'w', 'h']) if (typeof position[key] !== 'number') invalid(`position.${key} must be a number.`);
        body.position = position;
    }
    return body;
}
function request(name: string, args: JsonObject, body: JsonObject): ApiRequest {
    const app = name.startsWith('app'), create = name.endsWith('create');
    return { method: create ? 'POST' : 'PATCH', path: path(...(app ? ['base_apps', str(args, 'app-token'), 'pages', str(args, 'page-id'), 'blocks'] : ['bases', str(args, 'base-token'), 'dashboards', str(args, 'dashboard-id'), 'blocks']), ...(!create ? [str(args, 'block-id')] : [])), ...(app ? {} : { query: str(args, 'user-id-type') ? { user_id_type: str(args, 'user-id-type') } : {} }), body };
}
export function blockCapabilities(workflows?: WorkflowRunner): Capability[] {
    return blockDefinitions.map(definition => {
        const name = definition.id.slice(6), app = name.startsWith('app');
        return { definition, preview: async args => {
            const body = prepare(name, args);
            return app ? { program: `base-${name}`, request: request(name, args, body), note: 'Execution checks current blocks and workspace before writing.' } : { requests: [request(name, args, body)] };
        }, execute: async (args, context) => {
            const body = prepare(name, args);
            if (app) {
                if (!workflows) throw new ServiceError('CONFIGURATION_ERROR', 'Workflow runner is not configured.', 500);
                return workflows.start(`base-${name}`, { args, body, phase: 'start' }, context.selection, context.grant);
            }
            return { block: await context.lark.request(request(name, args, body)), [name.endsWith('create') ? 'created' : 'updated']: true };
        } };
    });
}
const items = (data: JsonObject, keys: string[]) => { for (const key of keys) if (Array.isArray(data[key])) return data[key].filter(object); return []; };
export function blockPrograms(): WorkflowProgram[] {
    return ['create', 'update'].map(action => ({ id: `base-app-block-${action}`, version: 1, domain: 'base', risk: 'write', identities: ['user', 'bot'], step: async (state, context) => {
        const args = state.args as JsonObject, name = `app-block-${action}`;
        const pending = (patch: JsonObject) => ({ done: false as const, state: { ...state, ...patch } });
        if (state.phase === 'start') {
            const body = prepare(name, args);
            return pending({ body, phase: action === 'create' || body.name ? 'names' : 'current', token: '' });
        }
        const body = state.body as JsonObject;
        const afterNames = () => action === 'update' && body.data_config ? 'current' : action === 'create' && String(body.type).toLowerCase() === 'list' && object(body.data_config) && str(body.data_config, 'base_token') ? 'app' : 'write';
        if (state.phase === 'names') {
            const data = await context.lark.request({ method: 'GET', path: path('base_apps', str(args, 'app-token'), 'pages', str(args, 'page-id'), 'blocks'), query: { page_size: 100, ...(state.token ? { page_token: state.token } : {}) } });
            for (const block of items(data, ['items', 'blocks', 'widgets'])) {
                const id = String(block.block_id || block.id || block.widget_id || '').trim();
                if (action === 'update' && id === str(args, 'block-id')) continue;
                if (str(block, 'name').toLowerCase() === String(body.name).toLowerCase()) invalid('Block names must be unique within the page.');
            }
            const token = String(data.page_token || data.next_page_token || '');
            if (data.has_more && token) { if (token === state.token) throw new ServiceError('UPSTREAM_ERROR', 'Repeated block page token.', 502); return pending({ token }); }
            return pending({ phase: afterNames(), token: '' });
        }
        if (state.phase === 'current') {
            if (!body.data_config) return pending({ phase: 'write' });
            const current = await context.lark.request({ method: 'GET', path: path('base_apps', str(args, 'app-token'), 'pages', str(args, 'page-id'), 'blocks', str(args, 'block-id')) });
            const type = String(current.type || current.block_type || '').trim();
            if (args['no-validate'] !== true) {
                const merged = { ...(object(current.data_config) ? current.data_config : {}), ...(body.data_config as JsonObject) };
                appConfig(type, type.toLowerCase() === 'list' ? subtype(current.sub_type || current.subType) : '', normalizeApp(merged));
            }
            return pending({ phase: type.toLowerCase() === 'list' && str(body.data_config as JsonObject, 'base_token') ? 'app' : 'write' });
        }
        if (state.phase === 'app') {
            const app = await context.lark.request({ method: 'GET', path: path('base_apps', str(args, 'app-token')) });
            const base = str(body.data_config as JsonObject, 'base_token');
            if (object(app.ref) && base in app.ref) return pending({ phase: 'write' });
            const workspace = String(app.workspace_token || app.workspace_id || '').trim();
            if (!workspace) invalid('App workspace could not be resolved.');
            return pending({ phase: 'workspace', workspace, token: '' });
        }
        if (state.phase === 'workspace') {
            const data = await context.lark.request({ method: 'GET', path: path('workspaces', state.workspace, 'entities'), query: { page_size: 30, entity_type: 'base', ...(state.token ? { page_token: state.token } : {}) } });
            const base = str(body.data_config as JsonObject, 'base_token');
            if (['items', 'entities'].some(key => items(data, [key]).some(entity => String(entity.token || entity.entity_token || '').trim() === base))) return pending({ phase: 'write' });
            const token = String(data.page_token || data.next_page_token || '');
            if (data.has_more && token) { if (token === state.token) throw new ServiceError('UPSTREAM_ERROR', 'Repeated workspace page token.', 502); return pending({ token }); }
            invalid('List Base must belong to the app workspace.');
        }
        if (state.phase !== 'write') throw new ServiceError('INTERNAL_ERROR', 'Invalid app block workflow state.', 500);
        return { done: true, output: { block: await context.lark.request(request(name, args, body)), [action === 'create' ? 'created' : 'updated']: true } };
    } }));
}

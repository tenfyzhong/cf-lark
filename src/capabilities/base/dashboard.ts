import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { dashboardDefinitions } from './dashboard-definitions';
const str = (args: JsonObject, key: string) => String(args[key] ?? '').trim();
function prepare(name: string, args: JsonObject): ApiRequest {
    const definition = dashboardDefinitions.find(d => d.id === `base.+${name}`)!;
    for (const key of definition.inputSchema.required as string[]) if (!str(args, key)) throw new ServiceError('INVALID_ARGUMENTS', `${key} is required.`);
    const path = (...parts: unknown[]) => `/open-apis/base/v3/${parts.map(p => encodeURIComponent(String(p))).join('/')}`;
    if (name === 'app-block-get-data') return { method: 'GET', path: path('base_apps', str(args, 'app-token'), 'blocks', str(args, 'block-id'), 'data'), query: { base_token: str(args, 'base-token') } };
    const action = name.slice('dashboard-'.length), parts: unknown[] = ['bases', args['base-token'], 'dashboards'];
    if (action === 'block-get-data') return { method: 'GET', path: path(...parts, 'blocks', args['block-id'], 'data') };
    if (!['list', 'create'].includes(action)) parts.push(args['dashboard-id']);
    if (action.startsWith('block')) { parts.push('blocks'); if (action !== 'block-list') parts.push(args['block-id']); }
    if (action === 'arrange') parts.push('arrange');
    const request: ApiRequest = { method: action === 'create' || action === 'arrange' ? 'POST' : action === 'update' ? 'PATCH' : action.endsWith('delete') ? 'DELETE' : 'GET', path: path(...parts) };
    if (action.endsWith('list')) {
        const size = args['page-size'] ?? (action === 'list' ? 100 : 20);
        if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > 100) throw new ServiceError('INVALID_ARGUMENTS', 'page-size must be between 1 and 100.');
        request.query = { page_size: size, ...(str(args, 'page-token') ? { page_token: str(args, 'page-token') } : {}) };
    }
    if (action === 'block-get' || action === 'arrange') request.query = str(args, 'user-id-type') ? { user_id_type: str(args, 'user-id-type') } : {};
    if (action === 'arrange') request.body = {};
    if (action === 'create' || action === 'update') {
        const body: JsonObject = action === 'create' ? { name: args.name } : str(args, 'name') ? { name: str(args, 'name') } : {};
        if (str(args, 'theme-style')) body.theme = { theme_style: str(args, 'theme-style') };
        request.body = body;
    }
    return request;
}
export function dashboardCapabilities(): Capability[] {
    return dashboardDefinitions.map(definition => {
        const name = definition.id.slice('base.+'.length);
        return { definition, preview: async args => ({ requests: [prepare(name, args)] }), execute: async (args, context) => {
            const data = await context.lark.request(prepare(name, args));
            if (name.endsWith('get-data') || name.endsWith('list')) return data;
            if (name.endsWith('arrange')) return { ...data, arranged: true };
            const block = name.includes('-block-');
            if (name.endsWith('delete')) return { deleted: true, [block ? 'block_id' : 'dashboard_id']: args[block ? 'block-id' : 'dashboard-id'] };
            return { [block ? 'block' : 'dashboard']: data, ...(name.endsWith('create') ? { created: true } : name.endsWith('update') ? { updated: true } : {}) };
        } };
    });
}

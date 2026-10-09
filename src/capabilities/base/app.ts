import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { appDefinitions, appThemes } from './app-definitions';
const str = (args: JsonObject, key: string) => String(args[key] ?? '').trim();
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function prepare(name: string, args: JsonObject): ApiRequest {
    const definition = appDefinitions.find(d => d.id === `base.+${name}`)!;
    for (const key of definition.inputSchema.required as string[]) if (!str(args, key)) invalid(`${key} is required.`);
    const path = (...segments: string[]) => `/open-apis/base/v3/${segments.map(encodeURIComponent).join('/')}`;
    const coordinate = (key: string) => String(args[key]);
    const query: JsonObject = {};
    if (name.endsWith('-list')) {
        const size = args['page-size'] ?? (name === 'workspace-entity-list' ? 30 : 20);
        if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || (name === 'workspace-entity-list' && size > 30)) invalid('Invalid page-size.');
        query.page_size = size;
        if (str(args, 'page-token')) query.page_token = str(args, 'page-token');
    }
    if (name === 'workspace-create') return { method: 'POST', path: path('workspaces'), body: { name: str(args, 'name') } };
    if (name === 'workspace-move-in') return { method: 'POST', path: path('workspaces', coordinate('workspace-token'), 'move_in'), body: { entity_token: str(args, 'entity-token') } };
    if (name === 'workspace-entity-list') {
        const type = str(args, 'type').toLowerCase();
        if (type && !['base', 'baseapp'].includes(type)) invalid('type must be base or baseapp.');
        if (type) query.entity_type = type;
        return { method: 'GET', path: path('workspaces', coordinate('workspace-token'), 'entities'), query };
    }
    if (name === 'app-create') {
        const body: JsonObject = { name: str(args, 'name'), workspace_token: str(args, 'workspace-token') };
        const theme = str(args, 'theme-style');
        if (theme && !appThemes.includes(theme)) invalid('Invalid theme-style.');
        if (theme) body.theme = { theme_style: theme };
        return { method: 'POST', path: path('base_apps'), body };
    }
    const segments = ['base_apps', coordinate('app-token')];
    if (name !== 'app-get') {
        segments.push('pages');
        if (name !== 'app-page-list') segments.push(coordinate('page-id'));
        if (name.startsWith('app-block')) {
            segments.push('blocks');
            if (name.endsWith('get')) segments.push(coordinate('block-id'));
        }
    }
    return { method: name.endsWith('delete') ? 'DELETE' : 'GET', path: path(...segments), ...(name.endsWith('list') ? { query } : {}) };
}
export function appCapabilities(): Capability[] {
    return appDefinitions.map(definition => {
        const name = definition.id.slice('base.+'.length);
        return { definition, preview: async args => ({ requests: [prepare(name, args)] }), execute: async (args, context) => {
            const data = await context.lark.request(prepare(name, args));
            if (name === 'workspace-create') return { workspace: data, created: true, ...(str(data, 'workspace_token') ? { workspace_token: str(data, 'workspace_token') } : {}), ...(str(data, 'url') ? { url: str(data, 'url') } : {}) };
            if (name === 'app-create') return { app: data, created: true, workspace_token: str(args, 'workspace-token') };
            if (name === 'app-page-get') return { page: data };
            if (name === 'app-block-get') return { block: data };
            if (name === 'app-page-delete') return { deleted: true, page_id: args['page-id'] };
            return data;
        } };
    });
}

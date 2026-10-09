import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { formDefinitions } from './form-definitions';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function prepare(name: string, args: JsonObject): ApiRequest {
    const definition = formDefinitions.find(d => d.id === `base.+${name}`)!;
    for (const key of definition.inputSchema.required as string[]) if (typeof args[key] !== 'string' || !args[key].trim()) invalid(`${key} is required.`);
    const segments: unknown[] = ['bases', args['base-token']];
    if (name !== 'base-get') {
        if (name.startsWith('form')) segments.push('tables', args['table-id'], 'forms', ...(name === 'form-create' ? [] : [args['form-id']]));
        else segments.push('dashboards', args['dashboard-id']);
        if (name.includes('-share-')) segments.push('share');
    }
    const request: ApiRequest = { method: name.endsWith('create') ? 'POST' : name.endsWith('update') ? 'PATCH' : name.endsWith('delete') ? 'DELETE' : 'GET', path: `/open-apis/base/v3/${segments.map(s => encodeURIComponent(String(s))).join('/')}` };
    if (name.includes('-share-update')) {
        const keys = ['enabled', 'access-scope', ...(name.startsWith('form') ? ['allow-anonymous', 'require-login'] : ['show-source'])].filter(key => Object.hasOwn(args, key));
        if (keys.length !== 1) invalid('Share updates require exactly one field.');
        const key = keys[0]!, value = args[key];
        if (key === 'access-scope' ? !['invite', 'tenant', 'anyone'].includes(String(value)) : typeof value !== 'boolean') invalid(`Invalid ${key}.`);
        request.body = ['enabled', 'access-scope'].includes(key) ? { [key.replaceAll('-', '_')]: value } : { settings: { [key.replaceAll('-', '_')]: value } };
    } else if (name === 'form-create' || name === 'form-update') {
        const body: JsonObject = {};
        for (const key of ['name', 'description']) if (args[key]) body[key] = args[key];
        request.body = body;
    }
    return request;
}
export function formCapabilities(): Capability[] {
    return formDefinitions.map(definition => {
        const name = definition.id.slice('base.+'.length);
        return { definition, preview: async args => ({ requests: [prepare(name, args)] }), execute: async (args, context) => {
            const data = await context.lark.request(prepare(name, args));
            if (name === 'base-get') return { base: data };
            if (name === 'form-delete') return { deleted: true, form_id: args['form-id'] };
            if (name.startsWith('dashboard-share') && data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
                const { enable_auto_analysis: _hidden, ...settings } = data.settings as JsonObject;
                return { ...data, settings };
            }
            return data;
        } };
    });
}

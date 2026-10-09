import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { directoryDefinitions } from './directory-definitions';
const string = (args: JsonObject, key: string) => String(args[key] ?? '').trim();
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function prepare(name: string, args: JsonObject): ApiRequest {
    const definition = directoryDefinitions.find(d => d.id === `base.+${name}`)!;
    for (const key of definition.inputSchema.required as string[]) if (!string(args, key)) invalid(`${key} is required.`);
    if (name.startsWith('template-')) {
        const action = name.slice('template-'.length);
        const path = '/open-apis/base/v3/bases/templates';
        if (action === 'categories') return { method: 'GET', path: `${path}/category` };
        const limit = args.limit ?? args['page-size'] ?? 10;
        if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) invalid('limit must be between 1 and 100.');
        const query: JsonObject = { limit };
        if (string(args, 'offset')) query.offset = string(args, 'offset');
        if (action === 'search') query.keyword = string(args, 'keyword');
        else if (string(args, 'category-key')) query.category_key = string(args, 'category-key');
        return { method: 'GET', path: `${path}${action === 'search' ? '/search' : ''}`, query };
    }
    const action = name.slice('base-block-'.length);
    const path = `/open-apis/base/v3/bases/${encodeURIComponent(String(args['base-token']))}/blocks`;
    const body: JsonObject = {};
    if (args.type && !['folder', 'table', 'docx', 'dashboard', 'workflow'].includes(string(args, 'type'))) invalid('Invalid block type.');
    if (action === 'list' || action === 'create') {
        if (string(args, 'parent-id')) body.parent_id = string(args, 'parent-id');
        if (action === 'create') Object.assign(body, { name: string(args, 'name'), type: string(args, 'type') });
        return { method: 'POST', path: `${path}${action === 'list' ? '/list' : ''}`, body };
    }
    const target = `${path}/${encodeURIComponent(String(args['block-id']))}`;
    if (action === 'delete') return { method: 'DELETE', path: target };
    if (action === 'rename') body.name = string(args, 'name');
    else {
        if (string(args, 'before-id') && string(args, 'after-id')) invalid('before-id and after-id are mutually exclusive.');
        body.parent_id = string(args, 'parent-id') || null;
        for (const key of ['before-id', 'after-id']) if (string(args, key)) body[key.replace('-', '_')] = string(args, key);
    }
    return { method: 'POST', path: `${target}/${action}`, body };
}
export function directoryCapabilities(): Capability[] {
    return directoryDefinitions.map(definition => {
        const name = definition.id.slice('base.+'.length);
        return { definition, preview: async args => ({ requests: [prepare(name, args)] }), execute: async (args, context) => {
            const data = await context.lark.request(prepare(name, args));
            if (name === 'template-categories') return { categories: data.categories ?? null };
            if (name.startsWith('template-')) return { templates: data.templates ?? null, has_more: data.has_more ?? null, offset: data.offset ?? null };
            const action = name.slice('base-block-'.length);
            if (action === 'list') {
                if (!string(args, 'type') || !Array.isArray(data.blocks)) return data;
                const blocks = data.blocks.filter(block => block && typeof block === 'object' && (block as JsonObject).type === string(args, 'type'));
                return { ...data, blocks, total: blocks.length };
            }
            return { block: data, [{ create: 'created', move: 'moved', rename: 'renamed', delete: 'deleted' }[action]!]: true };
        } };
    });
}

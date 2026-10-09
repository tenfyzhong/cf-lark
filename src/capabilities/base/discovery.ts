import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { discoveryDefinitions } from './discovery-definitions';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function object(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function prepare(title: boolean, args: JsonObject): ApiRequest {
    if (title) {
        const query = String(args.title ?? args.query ?? args.url ?? '').trim();
        if (!query || [...query].length > 30) invalid('title must contain between 1 and 30 characters.');
        return { method: 'POST', path: '/open-apis/search/v2/doc_wiki/search', body: { query, page_size: 5, doc_filter: { doc_types: ['BITABLE'] }, wiki_filter: { doc_types: ['BITABLE'] } } };
    }
    if (typeof args['base-token'] !== 'string' || !args['base-token'].trim()) invalid('base-token is required.');
    let body = args.dsl;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { invalid('dsl must be valid JSON.'); } }
    if (!object(body) || (!Object.hasOwn(body, 'dimensions') && !Object.hasOwn(body, 'measures'))) invalid('dsl must contain dimensions or measures.');
    return { method: 'POST', path: `/open-apis/base/v3/bases/${encodeURIComponent(args['base-token'])}/data/query`, ...(typeof args.dsl === 'string' ? { rawBody: args.dsl } : { body }) };
}
export function discoveryCapabilities(): Capability[] {
    return discoveryDefinitions.map(definition => {
        const title = definition.id.endsWith('title-resolve');
        return { definition, preview: async args => ({ requests: [prepare(title, args)] }), execute: async (args, context) => {
            const data = await context.lark.request(prepare(title, args));
            if (!title) return data;
            const candidates: JsonObject[] = [];
            for (const row of Array.isArray(data.res_units) ? data.res_units : []) {
                if (!object(row) || !object(row.result_meta)) continue;
                const meta = row.result_meta;
                if (String(meta.doc_types ?? '').toUpperCase() !== 'BITABLE' || !String(meta.token ?? '').trim()) continue;
                candidates.push({ title: String(row.title_highlighted ?? '').replace(/<\/?h>/g, '').trim() || String(row.title ?? '').trim(), base_token: String(meta.token).trim(), url: meta.url ?? '', owner_name: meta.owner_name ?? '', update_time: meta.update_time_iso ?? '' });
            }
            if (!candidates.length) invalid('No Base matched this title or keyword.');
            const base = { input_type: 'title_query', resource_type: 'bitable' };
            return candidates.length === 1 ? { ...base, ...candidates[0], hint: { next_step: 'use +base-block-list to list tables, dashboards, workflows, and other Base blocks' } } : { ...base, candidates, hint: { next_step: 'choose one candidate, then use +base-block-list to list tables, dashboards, workflows, and other Base blocks' } };
        } };
    });
}

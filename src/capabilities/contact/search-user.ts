import { ServiceError } from '../../domain/errors';
import type { Brand, JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { contactDefinitions } from './definitions';

const filters = { 'has-chatted': 'has_contact', 'has-enterprise-email': 'has_enterprise_email',
    'exclude-external-users': 'exclude_outer_contact', 'left-organization': 'is_resigned' };
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const csv = (value: unknown): string[] => [...new Set(text(value).split(',').map((part) => part.trim()).filter(Boolean))];
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function plan(args: JsonObject): { requests: ApiRequest[]; resolvesCurrentUser?: true; fanout: boolean } {
    const query = text(args.query).trim();
    const raw = text(args.queries).trim();
    const queries = raw ? csv(raw) : [query];
    const ids = csv(args['user-ids']);
    if (raw && (query || text(args['user-ids']).trim())) invalid('queries cannot be combined with query or user-ids.');
    if (!queries.length || queries.length > 20 || queries.some((item) => [...item].length > 50)) invalid('Supply at most 20 queries of at most 50 characters each.');
    if (ids.length > 100 || ids.some((id) => id !== 'me' && !id.startsWith('ou_'))) invalid('user-ids must contain at most 100 open IDs or me.');
    if (text(args['user-ids']).trim() && !ids.length) invalid('user-ids must contain at least one ID.');
    const pageSize = args['page-size'] ?? 20;
    if (!Number.isInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > 30) invalid('page-size must be between 1 and 30.');
    const filter: JsonObject = {};
    for (const [key, upstream] of Object.entries(filters)) {
        if (args[key] !== undefined) {
            if (args[key] !== true) invalid(`${key} must be true or omitted.`);
            filter[upstream] = true;
        }
    }
    if (ids.length) filter.user_ids = ids;
    if (!raw && !query && !Object.keys(filter).length) invalid('Supply a query, user IDs, or a filter.');
    return { fanout: Boolean(raw), ...(ids.includes('me') ? { resolvesCurrentUser: true } : {}), requests: queries.map((keyword) => ({
        method: 'POST', path: '/open-apis/contact/v3/users/search', query: { page_size: pageSize },
        body: { ...(keyword ? { query: keyword } : {}), ...(Object.keys(filter).length ? { filter: { ...filter } } : {}) },
    })) };
}
function project(value: unknown, lang: string, brand: Brand): JsonObject {
    const item = object(value); const meta = object(item.meta_data); const names = object(meta.i18n_names);
    const id = text(item.id);
    const locales = [lang.toLowerCase().replaceAll('-', '_'), ...(brand === 'lark' ? ['en_us', 'zh_cn'] : ['zh_cn', 'en_us']),
        'ja_jp', 'zh_hk', 'zh_tw', 'ko_kr', 'id_id', 'vi_vn', 'th_th', 'pt_br', 'es_es', 'de_de', 'fr_fr', 'it_it', 'ru_ru', ...Object.keys(names).sort()];
    const name = locales.map((locale) => text(names[locale])).find(Boolean) ?? id;
    const display = text(item.display_info); const lines = display.split('\n');
    const last = [...lines].reverse().find((line) => line.trim())?.trim() ?? '';
    return { open_id: id, localized_name: name, email: text(meta.mail_address), enterprise_email: text(meta.enterprise_mail_address),
        is_activated: meta.is_registered === true, is_cross_tenant: meta.is_cross_tenant === true, p2p_chat_id: text(meta.chat_id), has_chatted: Boolean(meta.chat_id),
        department: lines[1]?.trim() ?? '', ...(meta.description ? { signature: text(meta.description) } : {}),
        chat_recency_hint: /^\[(.+)\]$/u.exec(last)?.[1] ?? '', match_segments: [...display.matchAll(/<h>(.*?)<\/h>/gu)].map((match) => match[1]!) };
}
export function searchUserCapability(): Capability {
    return { definition: contactDefinitions.find((item) => item.id === 'contact.+search-user')!,
        async preview(args) { const { fanout: _fanout, ...preview } = plan(args); return preview; },
        async execute(args, context) {
            const prepared = plan(args);
            if (prepared.resolvesCurrentUser) {
                const user = await context.lark.request({ method: 'GET', path: '/open-apis/authen/v1/user_info' });
                if (typeof user.open_id !== 'string' || !user.open_id.startsWith('ou_')) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'The current user response has no open ID.', 502);
                for (const request of prepared.requests) {
                    const filter = object(object(request.body).filter);
                    filter.user_ids = [...new Set((filter.user_ids as string[]).map((id) => id === 'me' ? user.open_id : id))];
                }
            }
            const run = async (request: ApiRequest) => {
                const data = await context.lark.request(request);
                if (data.items !== undefined && !Array.isArray(data.items)) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Search items must be an array.', 502);
                return { users: (data.items as unknown[] | undefined ?? []).map((item) => project(item, text(args.lang), context.lark.brand ?? 'feishu')),
                    has_more: data.has_more === true, ...(data.notice ? { notice: text(data.notice) } : {}) };
            };
            if (!prepared.fanout) return run(prepared.requests[0]!);
            const results: PromiseSettledResult<Awaited<ReturnType<typeof run>>>[] = [];
            let next = 0;
            await Promise.all(Array.from({ length: Math.min(5, prepared.requests.length) }, async () => {
                while (next < prepared.requests.length) {
                    const index = next++;
                    try { results[index] = { status: 'fulfilled', value: await run(prepared.requests[index]!) }; }
                    catch (reason) { results[index] = { status: 'rejected', reason }; }
                }
            }));
            if (results.every((result) => result.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
            const users: JsonObject[] = []; const queries: JsonObject[] = []; let notice = '';
            results.forEach((result, index) => {
                const query = object(prepared.requests[index]!.body).query;
                if (result.status === 'rejected') {
                    queries.push({ query, has_more: false, error: result.reason instanceof ServiceError ? result.reason.message : 'The query failed.' });
                } else {
                    queries.push({ query, has_more: result.value.has_more, ...(result.value.notice ? { notice: result.value.notice } : {}) });
                    users.push(...result.value.users.map((user) => ({ ...user, matched_query: query })));
                    notice ||= result.value.notice ?? '';
                }
            });
            return { users, queries, ...(notice ? { notice } : {}) };
        },
    };
}

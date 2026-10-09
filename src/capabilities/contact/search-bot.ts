import { decodeHTML } from 'entities';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { contactDefinitions } from './definitions';

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const csv = (value: unknown): string[] => [...new Set(text(value).split(',').map((part) => part.trim()).filter(Boolean))];
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function plan(args: JsonObject): { requests: ApiRequest[]; fanout: boolean } {
    const query = text(args.query).trim(); const raw = text(args.queries).trim();
    const queries = raw ? csv(raw) : [query];
    if (raw && query) invalid('query and queries are mutually exclusive.');
    if (!queries.length || queries.length > 20 || queries.some((item) => !item || [...item].length > 50)) invalid('Supply one to 20 keywords of one to 50 characters each.');
    if (args['has-chatted'] !== undefined && args['has-chatted'] !== true) invalid('has-chatted must be true or omitted.');
    const pageSize = args['page-size'] ?? 20;
    if (!Number.isInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > 30) invalid('page-size must be between 1 and 30.');
    const ids = [...new Set(csv(args['chat-ids']).map((input) => {
        const id = input.includes('feishu.cn') || input.includes('larksuite.com') ? input.split('/').find((part) => part.startsWith('oc_')) ?? input : input;
        if (!id.startsWith('oc_')) invalid('chat-ids must contain chat IDs beginning with oc_.');
        return id;
    }))];
    if (ids.length > 100 || (text(args['chat-ids']).trim() && !ids.length)) invalid('chat-ids must contain one to 100 unique chat IDs.');
    const filter = { ...(ids.length ? { chat_ids: ids } : {}), ...(args['has-chatted'] ? { has_chatter: true } : {}) };
    return { fanout: Boolean(raw), requests: queries.map((keyword) => ({ method: 'POST', path: '/open-apis/bot/v4/bot/search', query: { page_size: pageSize },
        body: { query: keyword, ...(Object.keys(filter).length ? { filter } : {}) } })) };
}
function project(value: unknown): JsonObject {
    const item = object(value); const meta = object(item.meta_data); const display = text(item.display_info);
    const decode = (input: string) => decodeHTML(input.replaceAll('<h>', '').replaceAll('</h>', ''));
    const lines = display.split('\n').map((line) => decode(line).trim());
    const index = lines.findIndex(Boolean); const description = index >= 0 ? lines[index + 1] ?? '' : '';
    return { open_id: text(item.id), name: lines[index] ?? '', ...(description ? { description } : {}), chat_id: text(meta.chat_id),
        enable_join_group: meta.enable_join_group === true, is_agent: meta.is_agent === true,
        ...(meta.tenant_id ? { tenant_id: text(meta.tenant_id) } : {}),
        match_segments: [...display.matchAll(/<h>(.*?)<\/h>/gu)].map((match) => decode(match[1]!)).filter((part) => part.trim()) };
}
export function searchBotCapability(): Capability {
    return { definition: contactDefinitions.find((item) => item.id === 'contact.+search-bot')!,
        async preview(args) { return { requests: plan(args).requests }; },
        async execute(args, context) {
            const prepared = plan(args);
            const run = async (request: ApiRequest) => {
                const data = await context.lark.request(request);
                if (data.items !== undefined && !Array.isArray(data.items)) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Search items must be an array.', 502);
                return { bots: (data.items as unknown[] | undefined ?? []).map(project), has_more: data.has_more === true,
                    ...(data.notice ? { notice: text(data.notice) } : {}) };
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
            const recoverable = ['UPSTREAM_ERROR', 'UPSTREAM_HTTP_ERROR', 'UPSTREAM_UNAVAILABLE', 'INVALID_UPSTREAM_RESPONSE', 'OUTCOME_UNCERTAIN'];
            for (const result of results) if (result.status === 'rejected'
                && (!(result.reason instanceof ServiceError) || !recoverable.includes(result.reason.code))) throw result.reason;
            if (results.every((result) => result.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
            const bots: JsonObject[] = []; const queries: JsonObject[] = []; let notice = '';
            results.forEach((result, index) => {
                const query = object(prepared.requests[index]!.body).query;
                if (result.status === 'rejected') queries.push({ query, has_more: false, error: (result.reason as ServiceError).message });
                else {
                    queries.push({ query, has_more: result.value.has_more, ...(result.value.notice ? { notice: result.value.notice } : {}) });
                    bots.push(...result.value.bots.map((bot) => ({ ...bot, matched_query: query })));
                    notice ||= result.value.notice ?? '';
                }
            });
            return { bots, queries, ...(notice ? { notice } : {}) };
        },
    };
}

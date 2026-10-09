import type { JsonObject } from '../../domain/models';
import type { Capability, CommandContext } from '../../ports/capabilities';
import { invalid, obj, str } from './helpers';
import { driveSearchDefinition } from './search-definition';
function timestamp(value: unknown, now: number) {
    const text = str(value), relative = text.match(/^(\d+)(d|m|y)$/);
    if (relative) return Math.floor(now / 1000) - Number(relative[1]) * ({ d: 1, m: 30, y: 365 }[relative[2]!] || 1) * 86400;
    if (/^\d{10,}$/.test(text)) { const value = Number(text); if (Number.isSafeInteger(value)) return value >= 1e12 ? Math.floor(value / 1000) : value; }
    if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(text)) invalid('Time filters require a relative date, ISO date, or Unix timestamp.');
    const parsed = Date.parse(text.length === 10 ? `${text}T00:00:00Z` : /(?:Z|[+-]\d{2}:\d{2})$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
    if (!Number.isFinite(parsed)) invalid('Invalid time filter.'); return Math.floor(parsed / 1000);
}
function build(args: JsonObject, context: Pick<CommandContext, 'selection' | 'grant'> | undefined, now: number) {
    const list = (key: string) => str(args[key]).split(',').map((item) => item.trim()).filter(Boolean);
    if ([...String(args.query || '')].length > 30) invalid('query cannot exceed 30 Unicode code points.');
    if (args.mine && list('creator-ids').length) invalid('mine and creator-ids are mutually exclusive.');
    if (args['created-by-me'] && list('original-creator-ids').length) invalid('created-by-me and original-creator-ids are mutually exclusive.');
    if (list('folder-tokens').length && list('space-ids').length) invalid('folder-tokens and space-ids are mutually exclusive.');
    let size = Number(args['page-size'] ?? 15); if (!Number.isInteger(size)) invalid('page-size must be numeric.'); size = size <= 0 ? 15 : Math.min(size, 20);
    const filter: JsonObject = {}, warnings: string[] = [], openedSlices: { start: number; end: number }[] = [];
    const profile = context?.grant.profiles.find((item) => item.profileId === context.selection.profileId), user = context?.selection.accountId || (profile?.accounts.length === 1 ? profile.accounts[0] : undefined);
    if ((args.mine || args['created-by-me']) && !user) invalid('Self filters require an unambiguous authorized user account.');
    for (const key of ['creator-ids', 'original-creator-ids', 'sharer-ids', 'chat-ids']) {
        const values = list(key);
        if (['sharer-ids', 'chat-ids'].includes(key) && values.length > 20) invalid(`${key} supports at most 20 IDs.`);
        if (values.some((value) => !(key === 'chat-ids' ? /^oc_[A-Za-z0-9]+$/ : /^ou_[A-Za-z0-9]+$/).test(value))) invalid(`${key} requires valid open IDs.`);
        if (values.length) filter[key.replaceAll('-', '_')] = values;
    }
    if (args.mine) filter.creator_ids = [user]; if (args['created-by-me']) filter.original_creator_ids = [user];
    const docTypes = list('doc-types').map((type) => type.toUpperCase());
    if (docTypes.some((type) => !['DOC', 'SHEET', 'BITABLE', 'MINDNOTE', 'FILE', 'WIKI', 'DOCX', 'FOLDER', 'CATALOG', 'SLIDES', 'SHORTCUT'].includes(type))) invalid('Unsupported doc-types value.');
    if (docTypes.length) filter.doc_types = docTypes;
    for (const [prefix, key] of [['edited', 'my_edit_time'], ['commented', 'my_comment_time'], ['opened', 'open_time'], ['created', 'create_time']]) {
        const range: JsonObject = {};
        for (const [suffix, bound] of [['since', 'start'], ['until', 'end']]) {
            if (!args[`${prefix}-${suffix}`]) continue;
            let value = timestamp(args[`${prefix}-${suffix}`], now);
            if (prefix === 'edited' || prefix === 'commented') { const snapped = (bound === 'start' ? Math.floor : Math.ceil)(value / 3600) * 3600; if (snapped !== value) warnings.push(`${prefix}-${suffix} was snapped outward to an hourly boundary.`); value = snapped; }
            range[bound!] = value;
        }
        if (prefix === 'opened' && range.start !== undefined) {
            const end = Number(range.end ?? Math.floor(now / 1000)), start = Number(range.start), span = end - start;
            if (span > 365 * 86400) invalid('Opened time windows cannot exceed 365 days.');
            if (span > 90 * 86400) { for (let cursor = end; cursor > start; cursor -= 90 * 86400) openedSlices.push({ start: Math.max(start, cursor - 90 * 86400), end: cursor }); Object.assign(range, openedSlices[0]); warnings.push('Opened time was limited to the newest 90-day slice. Paginate each absolute slice independently.'); }
        }
        if (Object.keys(range).length) filter[key!] = range;
    }
    for (const key of ['only-title', 'only-comment']) if (args[key]) filter[key.replaceAll('-', '_')] = true;
    if (args.sort) { if (!['default', 'edit_time', 'edit_time_asc', 'open_time', 'create_time'].includes(str(args.sort))) invalid('Unsupported search sort.'); filter.sort_type = args.sort === 'default' ? 'DEFAULT_TYPE' : str(args.sort).toUpperCase(); }
    const body: JsonObject = { query: args.query || '', page_size: size, ...(args['page-token'] ? { page_token: args['page-token'] } : {}) };
    if (list('folder-tokens').length) body.doc_filter = { ...filter, folder_tokens: list('folder-tokens') };
    else if (list('space-ids').length) body.wiki_filter = { ...filter, space_ids: list('space-ids') };
    else { body.doc_filter = { ...filter }; body.wiki_filter = { ...filter }; }
    return { body, warnings, openedSlices };
}
function annotate(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(annotate);
    if (!value || typeof value !== 'object') return value;
    const input = obj(value), output: JsonObject = {};
    for (const [key, item] of Object.entries(input)) {
        output[key] = annotate(item);
        if (!key.endsWith('_time') || Object.hasOwn(input, `${key}_iso`) || !['number', 'string'].includes(typeof item) || item === '') continue;
        const number = Number(item), millis = number >= 1e12 ? number : number * 1000;
        if (Number.isFinite(millis) && Math.abs(millis) <= 8.64e15) output[`${key}_iso`] = new Date(Math.trunc(millis / 1000) * 1000).toISOString().replace('.000Z', 'Z');
    }
    return output;
}
export function driveSearchCapability(now: () => number = Date.now): Capability {
    return { definition: driveSearchDefinition,
        async preview(args, context) { const { body, warnings, openedSlices } = build(args, context, now()); return { requests: [{ method: 'POST', path: '/open-apis/search/v2/doc_wiki/search', body }], ...(warnings.length ? { warnings } : {}), ...(openedSlices.length ? { openedSlices } : {}) }; },
        async execute(args, context) { const { body, warnings, openedSlices } = build(args, context, now()), response = await context.lark.request({ method: 'POST', path: '/open-apis/search/v2/doc_wiki/search', body }); return { total: response.total, has_more: response.has_more, page_token: response.page_token, results: annotate(Array.isArray(response.res_units) ? response.res_units : []), ...(response.notice ? { notice: response.notice } : {}), ...(warnings.length ? { warnings } : {}), ...(openedSlices.length ? { openedSlices } : {}) }; },
    };
}

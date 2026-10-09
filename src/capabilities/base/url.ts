import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { WorkflowProgram } from '../../ports/workflows';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function object(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
function segment(path: string, prefix: string): string { return path.startsWith(prefix) ? path.slice(prefix.length).split('/')[0]!.trim() : ''; }
function hint(table = '') { return { next_step: table ? 'use +record-list to list records in the resolved table' : 'use +base-block-list to list tables, dashboards, workflows, and other Base blocks' }; }
export function urlInput(args: JsonObject): JsonObject {
    let url: URL;
    try { url = new URL(text(args.url ?? args.query)); } catch { invalid('url must be a full HTTP or HTTPS URL.'); }
    if (!['http:', 'https:'].includes(url.protocol)) invalid('url must use HTTP or HTTPS.');
    const path = decodeURIComponent(url.pathname);
    if (segment(path, '/base/workspace/') || segment(path, '/base/add/') || ['/share/base/view/', '/share/base/dashboard/'].some(prefix => segment(path, prefix))) invalid('This Base URL pattern is not supported by the pinned CLI.');
    const kinds = [['app', '/app/'], ['base', '/base/'], ['wiki', '/wiki/'], ['record', '/record/'], ['form', '/share/base/form/']];
    const match = kinds.find(([, prefix]) => segment(path, prefix!));
    if (!match) invalid('The URL is not a supported Base resource.');
    return { ...args, kind: match[0], token: segment(path, match[1]!), block: text(url.searchParams.get('table')), view: text(url.searchParams.get('view')), record: text(url.searchParams.get('record')), page: text(url.searchParams.get('pageId')), workspace: segment(url.searchParams.get('pre_pathname') ?? '', '/base/workspace/') };
}
interface State extends JsonObject { args: JsonObject; phase: string; output: JsonObject }
const route = (...parts: unknown[]) => '/open-apis/base/v3/' + parts.map(p => encodeURIComponent(String(p))).join('/');
export const urlProgram: WorkflowProgram = { id: 'base-url-resolve', version: 1, domain: 'base', risk: 'read', identities: ['user', 'bot'], step: async (raw, context) => {
    const state = raw as State;
    const pending = (patch: JsonObject) => ({ done: false as const, state: { ...state, ...patch } });
    const done = (output: JsonObject) => ({ done: true as const, output });
    if (state.phase === 'start') {
        const a = urlInput(state.args);
        if (a.kind === 'app') return done({ input_type: 'baseapp_url', resource_type: 'baseapp', app_token: a.token, ...(a.page ? { page_id: a.page } : {}), ...(a.workspace ? { workspace_token: a.workspace } : {}), hint: { next_step: 'use +app-get with app_token; list apps in a workspace with +workspace-entity-list --type baseapp' } });
        if (a.kind === 'form') return done({ input_type: 'form_share_url', resource_type: 'bitable_form', share_token: a.token, hint: { next_step: 'use +form-detail to inspect the form, or use +form-submit to submit a response' } });
        if (a.kind === 'wiki' || a.kind === 'record') return pending({ args: a, phase: String(a.kind) });
        const output = { input_type: 'base_url', resource_type: 'bitable', base_token: a.token, hint: hint(), ...(a.block ? { block_id: a.block, selection_source: 'url_query' } : {}) };
        return a.block ? pending({ args: a, output, phase: 'block' }) : done(output);
    }
    const a = state.args;
    if (state.phase === 'wiki') {
        const data = await context.lark.request({ method: 'GET', path: '/open-apis/wiki/v2/spaces/node_by_token', query: { token: a.token } });
        const node = object(data.node) ? data.node : {};
        if (node.obj_type !== 'bitable') invalid('The Wiki node does not resolve to a Base.');
        if (!text(node.obj_token)) throw new ServiceError('UPSTREAM_ERROR', 'The Wiki node response omitted obj_token.', 502);
        const output = { input_type: 'wiki_url', resource_type: 'bitable', wiki_node_token: a.token, base_token: node.obj_token, title: node.title ?? '', hint: hint(), ...(a.block ? { block_id: a.block, selection_source: 'url_query' } : {}) };
        return a.block ? pending({ output, phase: 'block' }) : done(output);
    }
    if (state.phase === 'record') {
        const data = await context.lark.request({ method: 'GET', path: route('record_share', a.token, 'meta') });
        const output = { input_type: 'record_share_url', resource_type: 'bitable', record_share_token: text(data.record_share_token) || a.token, base_token: data.base_token ?? '', table_id: data.table_id ?? '', record_id: data.record_id ?? '', hint: {} };
        return pending({ output, phase: 'record-data' });
    }
    const out = state.output;
    if (state.phase === 'block') {
        let blocks: unknown[] = [];
        try { const data = await context.lark.request({ method: 'POST', path: route('bases', out.base_token, 'blocks', 'list'), body: {} }); blocks = Array.isArray(data.blocks) ? data.blocks : []; } catch { /* Enrichment is best effort. */ }
        const block = blocks.find(value => object(value) && text(value.id) === a.block) as JsonObject | undefined;
        if (!block) return done({ ...out, hint: { next_step: 'use +base-block-list and match block_id to determine the selected resource type' } });
        const output: JsonObject = { ...out, block_type: text(block.type), ...(text(block.name) ? { block_name: text(block.name) } : {}) };
        if (block.type === 'table') return pending({ output: { ...output, table_id: a.block, ...(a.view ? { view_id: a.view } : {}), ...(a.record ? { record_id: a.record } : {}), hint: hint(String(a.block)) }, phase: 'fields' });
        const next = block.type === 'dashboard' ? 'use +dashboard-get to inspect this dashboard; match its name first if the requested dashboard differs' : block.type === 'workflow' ? 'use +workflow-get to inspect the resolved workflow' : block.type === 'folder' ? `use +base-block-list --base-token ${out.base_token} --parent-id ${a.block} to list this folder's direct children` : block.type === 'docx' && block.docx_token ? `use docs +fetch --doc ${block.docx_token} to read this document` : 'use +base-block-list and match block_id to determine the selected resource type';
        return done({ ...output, ...(block.type === 'dashboard' ? { dashboard_id: a.block } : block.type === 'workflow' ? { workflow_id: a.block } : block.type === 'docx' && block.docx_token ? { docx_token: block.docx_token } : {}), hint: { next_step: next } });
    }
    if (state.phase === 'record-data') {
        const extra: JsonObject = {};
        if (out.base_token && out.table_id && out.record_id) {
            try {
                const data = await context.lark.request({ method: 'POST', path: route('bases', out.base_token, 'tables', out.table_id, 'records', 'batch_get'), body: { record_id_list: [out.record_id] } });
                const ids = Array.isArray(data.field_id_list) ? data.field_id_list : [], names = Array.isArray(data.fields) ? data.fields : [], first = Array.isArray(data.data) && Array.isArray(data.data[0]) ? data.data[0] : [];
                extra.record_data = Object.fromEntries(first.map((value: unknown, i: number) => [text(ids[i]) || text(names[i]) || `field_${i + 1}`, value]));
            } catch { /* Preserve resolved record coordinates on readback failure. */ }
        }
        return pending({ output: { ...out, hint: extra }, phase: 'fields' });
    }
    const extra = object(out.hint) ? out.hint : {};
    if (out.base_token && out.table_id) {
        try {
            const data = await context.lark.request({ method: 'GET', path: route('bases', out.base_token, 'tables', out.table_id, 'fields'), query: { offset: 0, limit: 100 } });
            const fields = Array.isArray(data.fields) ? data.fields.filter(object) : [];
            extra.fields = { fields, total: Number(data.total) || fields.length };
        } catch { /* Field hints do not determine URL resolution success. */ }
    }
    return done({ ...out, hint: { ...extra, next_step: out.input_type === 'record_share_url' ? `use +record-batch-update with base-token ${out.base_token}, table-id ${out.table_id}, and record ID ${out.record_id}` : hint(String(out.table_id ?? '')).next_step } });
} };

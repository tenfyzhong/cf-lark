import { recordReadPrograms } from './record-read';
import type { BaseRecordFormatter } from './record-export';
import { attachmentPrograms } from './attachments';
import type { ArtifactFiles } from '../../ports/artifacts';
import { blockPrograms } from './blocks';
import { urlInput, urlProgram } from './url';
import { baseCreateInput, baseCreatePrograms } from './create';
import { copyInput, copyProgram } from './copy';
import { fieldCreateInput, fieldCreateProgram } from './field-create';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { programDefinitions } from './program-definitions';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function object(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function json(value: unknown): unknown { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return invalid('Invalid inline JSON.'); } }
function objects(value: unknown, key: string, arrayOnly = false): JsonObject[] {
    value = json(value);
    if (!Array.isArray(value)) { if (arrayOnly || !object(value)) invalid(`${key} must contain JSON objects.`); value = [value]; }
    const values = value as unknown[];
    if (!values.every(object)) invalid(`${key} must contain JSON objects.`);
    return values;
}
function prepare(name: string, args: JsonObject): JsonObject {
    const definition = programDefinitions.find(d => d.id === `base.+${name}`)!;
    for (const key of definition.inputSchema.required as string[]) if (!['json', 'fields'].includes(key) && (typeof args[key] !== 'string' || !args[key].trim())) invalid(`${key} is required.`);
    if (name === 'button-rule-bind' && !String(args['workflow-id']).trim().startsWith('wkf')) invalid('workflow-id must be a public wkf ID.');
    if (name === 'url-resolve') return urlInput(args);
    if (name === 'base-copy' || name === 'base-create') return baseCreateInput(name, args);
    if (name === 'table-copy') return copyInput(args);
    if (name === 'field-create') return { ...args, json: fieldCreateInput(args) };
    if (name === 'table-create') {
        const fields = objects(args.fields, 'fields', true);
        if (!fields.length) invalid('fields must not be empty.');
        return { ...args, fields, ...(args.view === undefined ? {} : { view: objects(args.view, 'view') }) };
    }
    if (name === 'view-create') return { ...args, json: objects(args.json, 'json') };
    if ((name === 'workflow-list' || name === 'form-list')) {
        const size = args['page-size'] ?? 100;
        if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > 100) invalid('page-size must be between 1 and 100.');
        if (args.status !== undefined && !['enabled', 'disabled'].includes(String(args.status))) invalid('Invalid workflow status.');
        return { ...args, 'page-size': size };
    }
    return args;
}
function path(...segments: unknown[]): string { return `/open-apis/base/v3/${segments.map(value => encodeURIComponent(String(value))).join('/')}`; }
function rows(data: JsonObject, key: string): JsonObject[] { return Array.isArray(data[key]) ? (data[key] as unknown[]).filter(object) : []; }
interface State extends JsonObject { args: JsonObject; phase: string; items: JsonObject[]; index: number; output: JsonObject; token: string; offset: number }
export function basePrograms(artifacts?: ArtifactFiles, recordFormatter?: BaseRecordFormatter): WorkflowProgram[] {
    return [...recordReadPrograms(artifacts, recordFormatter), ...attachmentPrograms(artifacts), ...blockPrograms(), ...programDefinitions.map<WorkflowProgram>(definition => {
        if (definition.id === 'base.+url-resolve') return urlProgram;
        if (definition.id === 'base.+base-create' || definition.id === 'base.+base-copy') return baseCreatePrograms().find(program => program.id === `base-${definition.id.slice('base.+'.length)}`)!;
        if (definition.id === 'base.+table-copy') return copyProgram;
        if (definition.id === 'base.+field-create') return fieldCreateProgram;
        const name = definition.id.slice('base.+'.length);
        return { id: `base-${name}`, version: 1, domain: 'base', risk: definition.risk, identities: definition.identities,
            step: async (raw, context) => {
                const state = raw as State;
                if (state.phase === 'start') return { done: false, state: { args: prepare(name, state.args), phase: 'run', items: [], index: 0, output: {}, token: '', offset: 0 } };
                const a = state.args;
                const pending = (patch: JsonObject) => ({ done: false as const, state: { ...state, ...patch } });
                const done = (output: unknown) => ({ done: true as const, output });
                if (name.startsWith('button-rule-')) {
                    if (state.phase === 'run') {
                        const data = await context.lark.request({ method: 'GET', path: path('bases', a['base-token'], 'tables', String(a['table-id']).trim(), 'fields', String(a['field-id']).trim()) });
                        const field = String(data.id || data.field_id || '').trim();
                        if (!field.startsWith('fld')) throw new ServiceError('UPSTREAM_ERROR', 'Field resolution did not return a canonical fld ID.', 502);
                        return pending({ phase: 'relation', field });
                    }
                    return done(await context.lark.request({ method: name.endsWith('get') ? 'GET' : 'PUT', path: path('bases', a['base-token'], 'tables', String(a['table-id']).trim(), 'fields', state.field, 'button_rule'), ...(name.endsWith('get') ? {} : { body: { workflow_id: name.endsWith('unbind') ? '' : String(a['workflow-id']).trim() } }) }));
                }
                if (name === 'table-get') {
                    if (state.phase === 'run') {
                        const table = await context.lark.request({ method: 'GET', path: path('bases', a['base-token'], 'tables', a['table-id']) });
                        return pending({ phase: 'fields', output: { table }, items: [], offset: 0 });
                    }
                    const data = await context.lark.request({ method: 'GET', path: path('bases', a['base-token'], 'tables', a['table-id'], state.phase), query: { offset: state.offset, limit: 100 } });
                    const batch = rows(data, state.phase), items = [...state.items, ...batch], total = Number(data.total) || batch.length;
                    if (batch.length >= 100 && items.length < total) return pending({ items, offset: state.offset + batch.length });
                    const output = { ...state.output, [state.phase]: items };
                    return state.phase === 'fields' ? pending({ phase: 'views', output, items: [], offset: 0 }) : done(output);
                }
                if (name === 'table-create') {
                    if (state.phase === 'run') {
                        const table = await context.lark.request({ method: 'POST', path: path('bases', a['base-token'], 'tables'), body: { name: a.name, fields: a.fields } });
                        const id = table.id ?? table.table_id;
                        const output = { table, ...(id && table.fields !== undefined ? { fields: table.fields } : {}) };
                        if (!id || a.view === undefined) return done(output);
                        return pending({ phase: 'views', output, table: id, index: 0, items: [] });
                    }
                    const views = a.view as JsonObject[];
                    if (state.index >= views.length) return done({ ...state.output, views: state.items });
                    const view = await context.lark.request({ method: 'POST', path: path('bases', a['base-token'], 'tables', state.table, 'views'), body: views[state.index] });
                    return pending({ index: state.index + 1, items: [...state.items, view] });
                }
                if (name === 'view-create') {
                    const views = a.json as JsonObject[];
                    if (state.index >= views.length) return done({ views: state.items });
                    const view = await context.lark.request({ method: 'POST', path: path('bases', a['base-token'], 'tables', a['table-id'], 'views'), body: views[state.index] });
                    return pending({ index: state.index + 1, items: [...state.items, view] });
                }
                if ((name === 'workflow-list' || name === 'form-list')) {
                    const body: JsonObject = { page_size: a['page-size'], ...(a.status ? { status: a.status } : {}), ...(state.token ? { page_token: state.token } : {}) };
                    const form = name === 'form-list';
                    const data = await context.lark.request(form ? { method: 'GET', path: path('bases', a['base-token'], 'tables', a['table-id'], 'forms'), query: body } : { method: 'POST', path: path('bases', a['base-token'], 'workflows', 'list'), body });
                    const value = data[form ? 'forms' : 'items'];
                    const items = [...state.items, ...(Array.isArray(value) ? value : [])];
                    if (data.has_more && typeof data.page_token === 'string' && data.page_token) {
                        if (data.page_token === state.token) throw new ServiceError('UPSTREAM_ERROR', 'The upstream cursor did not advance.', 502);
                        return pending({ items, token: data.page_token });
                    }
                    return done({ [form ? 'forms' : 'items']: items, total: items.length });
                }
                const rename = name === 'app-page-update';
                if (state.phase === 'run') {
                    const data = await context.lark.request({ method: 'GET', path: path('base_apps', a['app-token'], 'pages'), query: { page_size: 100, ...(state.token ? { page_token: state.token } : {}) } });
                    const pages = Array.isArray(data.items) ? rows(data, 'items') : rows(data, 'pages');
                    for (const page of pages) {
                        const id = String(page.page_id ?? page.id ?? '').trim();
                        if (id === (rename ? String(a['page-id']).trim() : '')) continue;
                        if (String(page.name ?? '').trim().toLowerCase() === String(a.name).trim().toLowerCase()) invalid('Page names must be unique within the app.');
                    }
                    const token = data.page_token || data.next_page_token;
                    if (data.has_more && typeof token === 'string' && token) {
                        if (token === state.token) throw new ServiceError('UPSTREAM_ERROR', 'The upstream cursor did not advance.', 502);
                        return pending({ token });
                    }
                    return pending({ phase: 'write' });
                }
                const page = await context.lark.request({ method: rename ? 'PATCH' : 'POST', path: path('base_apps', a['app-token'], 'pages', ...(rename ? [a['page-id']] : [])), body: { name: String(a.name).trim() } });
                return done({ page, [rename ? 'updated' : 'created']: true });
            },
        };
    })];
}
export function programCapabilities(runner?: WorkflowRunner): Capability[] {
    return programDefinitions.map(definition => {
        const name = definition.id.slice('base.+'.length);
        return { definition, preview: async args => ({ program: `base-${name}`, args: prepare(name, args), bounded: true }), execute: async (args, context) => {
            const prepared = prepare(name, args);
            if (!runner) throw new ServiceError('WORKFLOW_UNAVAILABLE', 'Workflow execution is unavailable.', 500);
            return runner.start(`base-${name}`, { args: prepared, phase: 'start' }, context.selection, context.grant);
        } };
    });
}

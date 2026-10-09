import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { fieldDefinitions } from './field-definitions';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function object(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function parsed(value: unknown): JsonObject { if (typeof value === 'string') { try { value = JSON.parse(value); } catch { invalid('json must contain valid JSON.'); } } if (!object(value)) invalid('json must be an object.'); return value; }
function keys(value: JsonObject, allowed: string[]) { for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`Unknown field ${key}.`); }
function extension(value: unknown): JsonObject {
    const body = parsed(value);
    if (!Object.keys(body).length) return body;
    keys(body, ['extension_id', 'inputs']);
    if (body.extension_id !== 'builtin_llm_completion' || !object(body.inputs)) invalid('A completion extension and inputs are required.');
    keys(body.inputs, ['prompt']);
    const prompt = body.inputs.prompt;
    if (!Array.isArray(prompt) || !prompt.length) invalid('A nonempty prompt is required.');
    const normalized: JsonObject[] = [];
    for (const item of prompt) {
        if (!object(item)) invalid('Prompt segments must be objects.');
        keys(item, ['type', 'text', 'field']);
        if (item.type === 'text') {
            if (typeof item.text !== 'string' || (item.field !== undefined && item.field !== null)) invalid('Text segments require text and forbid field.');
            normalized.push({ type: 'text', text: item.text });
        } else if (item.type === 'field_ref') {
            if (typeof item.field !== 'string' || !item.field || (item.text !== undefined && item.text !== null)) invalid('Field reference segments require field and forbid text.');
            normalized.push({ type: 'field_ref', field: item.field });
        } else invalid('Prompt type must be text or field_ref.');
    }
    return { extension_id: body.extension_id, inputs: { prompt: normalized } };
}
function prepare(name: string, args: JsonObject): ApiRequest {
    for (const key of ['base-token', 'table-id', 'field-id']) if (typeof args[key] !== 'string' || !args[key].trim()) invalid(`${key} is required.`);
    const path = '/open-apis/base/v3/' + ['bases', args['base-token'], 'tables', String(args['table-id']).trim(), 'fields', args['field-id']].map(v => encodeURIComponent(String(v))).join('/');
    if (name === 'field-update') {
        const body = parsed(args.json);
        if (['formula', 'lookup'].includes(String(body.type ?? '').trim().toLowerCase()) && args['i-have-read-guide'] !== true) invalid('i-have-read-guide is required for formula and lookup fields.');
        return { method: 'PUT', path, body };
    }
    if (name.endsWith('-get')) return { method: 'GET', path: `${path}/field_extensions` };
    if (name.endsWith('-update')) return { method: 'PUT', path: `${path}/field_extensions`, body: extension(args.json) };
    const type = String(args.type ?? '').trim(), view = String(args['view-id'] ?? '').trim();
    const input = args['record-id'] ?? [];
    if (!Array.isArray(input) || !input.every(id => typeof id === 'string' && id.trim())) invalid('record-id must contain nonempty strings.');
    const ids = input.map(id => String(id).trim());
    if (new Set(ids).size !== ids.length) invalid('record-id must not contain duplicates.');
    let body: JsonObject;
    if (type === 'column') { if (ids.length) invalid('record-id is only valid for row updates.'); body = { type, ...(view ? { view_id: view } : {}) }; }
    else if (type === 'row') { if (view || !ids.length) invalid('Row updates require record-id and forbid view-id.'); body = { type, record_ids: ids }; }
    else invalid('type must be column or row.');
    return { method: 'POST', path: `${path}/field_extensions/update_cells`, body };
}
export function fieldCapabilities(): Capability[] {
    return fieldDefinitions.map(definition => {
        const name = definition.id.slice('base.+'.length);
        return { definition, preview: async args => ({ requests: [prepare(name, args)] }), execute: async (args, context) => {
            const request = prepare(name, args), data = await context.lark.request(request);
            if (name !== 'field-update') return data;
            const nested = object(data.field) ? data.field : {};
            const returned = String(data.type || nested.type || '').trim().toLowerCase();
            const submitted = String((request.body as JsonObject).type ?? '').trim().toLowerCase();
            const hint = returned && submitted && returned !== submitted
                ? `field update submitted type "${submitted}" but the server returned type "${returned}"; run +field-get and verify record values before declaring completion`
                : `field update request succeeded for type "${returned || submitted}"; run +field-get and sample record values if the type changed before declaring completion`;
            return { field: data, updated: true, field_get_recommended: true, verification_hint: hint, next_step: 'field_get' };
        } };
    });
}

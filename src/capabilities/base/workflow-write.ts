import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { workflowWriteDefinitions } from './workflow-definitions';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function object(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
const string = (value: unknown) => typeof value === 'string' ? value : '';
function classification(step: JsonObject, index: number, ids: Map<string, number>): void {
    const data = step.data;
    if (!object(data)) invalid('AI classification data must be an object.');
    if (Object.hasOwn(data, 'mode')) invalid('AI classification mode must be omitted.');
    if (!Array.isArray(data.classes) || data.classes.length < 2) invalid('AI classification requires at least two classes.');
    const names: string[] = [];
    for (const value of data.classes) {
        if (!object(value) || typeof value.desc !== 'string') invalid('Each class requires a name and string desc.');
        const name = string(value.name).trim();
        if (!name || /[\r\n]/.test(name) || names.includes(name)) invalid('Class names must be nonblank, unique, and single-line.');
        names.push(name);
    }
    if (!Array.isArray(data.content)) invalid('Classification content must be an array.');
    let hasContent = false;
    for (const item of data.content) {
        if (!object(item)) invalid('Classification content items must be objects.');
        const value = string(item.value).trim();
        if (item.value_type === 'text') { hasContent ||= !!value; continue; }
        if (item.value_type !== 'ref') invalid('Content value_type must be text or ref.');
        const id = value.startsWith('$.') ? value.slice(2).split('.')[0]! : '';
        if (!id || !ids.has(id) || ids.get(id)! >= index) invalid('Content references must target an earlier workflow step.');
        hasContent = true;
    }
    if (!hasContent) invalid('Classification content must contain text or a reference.');
    if (Object.hasOwn(data, 'classification_rule') && typeof data.classification_rule !== 'string') invalid('classification_rule must be a string.');
    if (Object.hasOwn(data, 'no_match_action') && !['classifyToOther', 'fail'].includes(string(data.no_match_action))) invalid('Invalid no_match_action.');
    const noMatch = data.no_match_action ?? 'classifyToOther';
    const links = object(step.children) && Array.isArray(step.children.links) ? step.children.links : [];
    if (!links.length) invalid('Classification requires one case link per class.');
    let ordinary = 0, defaults = 0; const targets = new Set<string>();
    for (const link of links) {
        if (!object(link) || link.kind !== 'case' || link.label === 'other') invalid('Classification links require kind case and valid labels.');
        const to = string(link.to).trim();
        if (!to || !ids.has(to) || targets.has(to)) invalid('Classification links require unique existing targets.');
        targets.add(to);
        if (link.label === 'default') { defaults++; continue; }
        if (link.label !== `branch_${ordinary + 1}` || (ordinary < names.length && link.desc !== names[ordinary])) invalid('Classification case order and description must match classes.');
        ordinary++;
    }
    if (ordinary !== names.length || (noMatch === 'classifyToOther' ? defaults !== 1 : defaults !== 0)) invalid('Classification branches do not match classes and no-match policy.');
}
function body(value: unknown): JsonObject {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { invalid('json must be valid JSON.'); } }
    if (!object(value)) invalid('json must be an object.');
    if (!Array.isArray(value.steps)) return value;
    const ids = new Map<string, number>();
    value.steps.forEach((step, index) => { if (object(step) && string(step.id).trim()) ids.set(string(step.id), index); });
    value.steps.forEach((step, index) => {
        if (!object(step)) return;
        if (step.type === 'AIClassificationBranch') classification(step, index, ids);
        if (step.type !== 'AIAnalysisAction' || !object(step.data)) return;
        if (Object.hasOwn(step.data, 'analysis_table_names') && (!Array.isArray(step.data.analysis_table_names) || !step.data.analysis_table_names.every(item => typeof item === 'string'))) invalid('analysis_table_names must be a string array.');
        if (Object.hasOwn(step.data, 'identity_type') && !['maker', 'triggerPersonal'].includes(string(step.data.identity_type))) invalid('identity_type must be maker or triggerPersonal.');
    });
    return value;
}
function prepare(update: boolean, args: JsonObject): ApiRequest {
    for (const key of ['base-token', ...(update ? ['workflow-id'] : [])]) if (!string(args[key]).trim()) invalid(`${key} is required.`);
    return { method: update ? 'PUT' : 'POST', path: `/open-apis/base/v3/bases/${encodeURIComponent(String(args['base-token']))}/workflows${update ? `/${encodeURIComponent(String(args['workflow-id']))}` : ''}`, body: body(args.json) };
}
export function workflowWriteCapabilities(): Capability[] {
    return workflowWriteDefinitions.map(definition => ({ definition, preview: async args => ({ requests: [prepare(definition.id.endsWith('update'), args)] }), execute: async (args, context) => context.lark.request(prepare(definition.id.endsWith('update'), args)) }));
}

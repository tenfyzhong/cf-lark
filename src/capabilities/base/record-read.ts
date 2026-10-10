import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { recordReadDefinitions } from './record-read-definitions';
import { prepareRecordRead, recordReadFormat, invalid, type ReadPlan } from './record-read-input';
import { exportRecords, type BaseRecordFormatter } from './record-export';
export interface RecordReadDependencies { workflows?: WorkflowRunner; artifacts?: ArtifactFiles; recordFormatter?: BaseRecordFormatter; }
const inputKeys = ['json', 'fields', 'filter-json', 'sort-json'];
const refs = (args: JsonObject): string[] => inputKeys.filter(key => typeof args[key] === 'string' && String(args[key]).trim().startsWith('@'));
async function resolveInputs(args: JsonObject, context: CommandContext, artifacts?: ArtifactFiles): Promise<JsonObject> {
    const keys = refs(args); if (!keys.length) return args;
    authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
    if (!artifacts) throw new ServiceError('UNAVAILABLE', 'Artifact inputs are unavailable.', 503);
    const output = { ...args };
    for (const key of keys) {
        const id = String(args[key]).trim().slice(1).trim(); const stat = await artifacts.stat(context.grant.id, id);
        if (stat.size > 2 * 1024 * 1024) invalid('JSON artifact exceeds 2 MiB.');
        const response = await artifacts.read(context.grant.id, id);
        try { output[key] = JSON.parse(await response.text()); } catch { invalid('Artifact must contain valid JSON.'); }
    }
    return output;
}
async function validateJq(plan: ReadPlan, formatter?: BaseRecordFormatter): Promise<void> {
    if (!plan.args['jq-records']) return;
    if (!formatter) throw new ServiceError('UNAVAILABLE', 'Record jq processing is unavailable.', 503);
    await formatter.process({ operation: 'jq-validate', expression: plan.args['jq-records'] });
}
export function recordReadCapabilities(dependencies: RecordReadDependencies): Capability[] {
    return recordReadDefinitions.map(definition => { const action = definition.id.split('-').at(-1)!; return { definition,
        preview: async args => {
            recordReadFormat(args);
            if (refs(args).length) return { command: definition.id, deferredArtifactValidation: true, artifacts: refs(args).map(key => ({ argument: key, id: String(args[key]).trim().slice(1) })), requests: [] };
            const plan = prepareRecordRead(action, args); await validateJq(plan, dependencies.recordFormatter);
            return { request: plan.request, format: plan.format, ...(plan.format === 'ndjson' ? { storage: 'private artifacts', page_size: plan.limit } : {}) };
        },
        execute: async (args, context) => {
            recordReadFormat(args);
            const plan = prepareRecordRead(action, await resolveInputs(args, context, dependencies.artifacts)); await validateJq(plan, dependencies.recordFormatter);
            if (plan.format === 'ndjson') { authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now()); if (!dependencies.workflows) throw new ServiceError('UNAVAILABLE', 'Record export workflows are unavailable.', 503); return dependencies.workflows.start('base-record-read', { plan, phase: 'read', pages: [] }, context.selection, context.grant); }
            const data = await context.lark.request(plan.request);
            if (plan.format === 'json') return data;
            if (!dependencies.recordFormatter) throw new ServiceError('UNAVAILABLE', 'Record Markdown conversion is unavailable.', 503);
            try { return { markdown: await dependencies.recordFormatter.process({ operation: 'markdown', data, get: action === 'get' }) }; }
            catch { return { ...data, _notice: 'Record Markdown rendering failed; returning the original matrix.' }; }
        },
    }; });
}
export function recordReadPrograms(artifacts?: ArtifactFiles, formatter?: BaseRecordFormatter): WorkflowProgram[] {
    return [{ id: 'base-record-read', version: 2, domain: 'base', risk: 'read', identities: ['user', 'bot'], step: async (state, context) => {
        const plan = state.plan as unknown as ReadPlan, pages = state.pages as JsonObject[];
        if (state.phase === 'export') return { done: true, output: await exportRecords(pages, plan.args, plan.action, plan.offset, plan.limit, context, artifacts, formatter) };
        const data = await context.lark.request(plan.request);
        if (!Array.isArray(data.record_id_list) || !Array.isArray(data.data) || data.record_id_list.length !== data.data.length) throw new ServiceError('UPSTREAM_ERROR', 'Record matrix rows do not match record IDs.', 502);
        const count = data.data.length;
        if (count > plan.limit) throw new ServiceError('UPSTREAM_ERROR', 'Record API returned more rows than requested.', 502);
        return { done: false, state: { ...state, pages: [data], phase: 'export' } };
    } }];
}

export type { BaseRecordFormatter } from './record-export';

import { resolveSheetFiles } from './file-inputs';
import { normalizeSheetFlags } from './flag-normalization';
import { chartExamples } from './generated/chart-examples';
import { chartBatchInput } from './chart-batch-input';
import { workbookConversionInput } from './conversion-input';
import { chartInput } from './chart-input';
import { tableWriteInput } from './table-write-input';
import { stylesPlan } from './declarative-styles';
import type { WorkflowRunner } from '../../ports/workflows';
import { batchInput, batchOutput, compactBatchOutput } from './batch';
import { authorize } from '../../domain/authorization';
import type { ArtifactStore } from '../../ports/artifacts';
import { readOutput } from './read-output';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest, LarkClient } from '../../ports/lark';
import { objectInput } from './objects';
import { enrichInput } from './inputs';
import { sheetSpecs, sheetsDefinitions, type SheetSpec } from './definitions';
function example(type: unknown): unknown { const value = chartExamples[String(type) as keyof typeof chartExamples]; if (!value) invalid(`No example for this chart type. Available: ${Object.keys(chartExamples).sort().join(', ')}.`); return structuredClone(value); }
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function clean(value: unknown): string {
    if (value === undefined) return '';
    if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) invalid('Expected a string without control characters.');
    return value.trim();
}
function locator(args: JsonObject) {
    const values = [args.url, args.token, args['spreadsheet-token']].filter(v => v !== undefined);
    if (values.length !== 1) invalid('Provide exactly one url, spreadsheet-token, or token.');
    const value = clean(values[0]);
    if (!value) invalid('The spreadsheet locator must not be blank.');
    if (args.url === undefined) return { token: value, wiki: false };
    let url: URL;
    try { url = new URL(value); } catch { return invalid('Invalid spreadsheet URL.'); }
    const match = /^\/(sheets|spreadsheets|wiki)\/([^/]+)/.exec(url.pathname);
    if (!match) invalid('Expected a spreadsheet or wiki URL.');
    return { token: clean(decodeURIComponent(match[2]!)), wiki: match[1] === 'wiki' };
}
function input(spec: SheetSpec, args: JsonObject, token: string): JsonObject {
    args = normalizeSheetFlags(spec.name, args);
    if (['workbook-import', 'workbook-export'].includes(spec.name)) return workbookConversionInput(spec.name, args, token);
    if (['table-put', 'workbook-create'].includes(spec.name)) { tableWriteInput(args, spec.name === 'workbook-create'); return { excel_id: token }; }
    if (['batch-chart-create', 'batch-chart-update'].includes(spec.name)) return chartBatchInput(spec.name, args, token);
    if (spec.name === 'batch-update') return batchInput(args, token, sheetSpecs, input);
    if (spec.name === 'styles-put') { const plan = stylesPlan(args, token); return { excel_id: token, operations: plan.operations, __needsGrid: plan.needsGrid }; }
    const value: JsonObject = { excel_id: token };
    if (spec.selector) {
        const id = clean(args['sheet-id']), name = clean(args['sheet-name']);
        if (id && name) invalid('sheet-id and sheet-name are mutually exclusive.');
        if (id) value.sheet_id = id;
        if (name) value.sheet_name = name;
    }
    if (spec.filter && clean(args[spec.filter])) value[spec.field!] = clean(args[spec.filter]);
    if (spec.name === 'changeset-get') {
        const start = args['start-revision'], end = args['end-revision'] ?? 0;
        if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end) || (end > 0 && (end < start || end - start + 1 > 20))) invalid('Require a positive start revision and at most 20 ordered revisions.');
        value.start_revision = start;
        if (end > 0) value.end_revision = end;
    }
    if (spec.name === 'history-list' && Object.hasOwn(args, 'end-version')) {
        if (!Number.isSafeInteger(args['end-version'])) invalid('end-version must be an integer.');
        value.end_version = args['end-version'];
    }
    for (const flag of ['history-version-id', 'transaction-id']) if (spec.extra?.[flag]) {
        const target = clean(args[flag]);
        if (!target) invalid(`${flag} is required.`);
        value[flag.replaceAll('-', '_')] = target;
    }
    if (spec.operation) {
        value.operation = spec.operation;
        if (spec.name === 'sheet-delete' && !value.sheet_id && !value.sheet_name) invalid('Deletion requires an explicit sheet-id or sheet-name.');
        if (['sheet-create', 'sheet-rename'].includes(spec.name) && !clean(args.title)) invalid('title is required.');
        if (['sheet-copy', 'sheet-rename'].includes(spec.name) && clean(args.title)) value.new_name = clean(args.title);
        if (spec.name === 'sheet-create') {
            if (args.type !== undefined && args.type !== 'sheet') invalid('type must be sheet.');
            value.sheet_name = clean(args.title);
            const rows = args['row-count'] ?? 200, cols = args['col-count'] ?? 20;
            if (typeof rows !== 'number' || typeof cols !== 'number' || !Number.isSafeInteger(rows) || rows < 0 || rows > 50000 || !Number.isSafeInteger(cols) || cols < 0 || cols > 200) invalid('Invalid sheet dimensions.');
            if (rows > 0) value.rows = rows;
            if (cols > 0) value.columns = cols;
        }
        if (Object.hasOwn(args, 'index')) {
            if (!Number.isSafeInteger(args.index)) invalid('index must be an integer.');
            value.target_index = args.index;
        }
        if (spec.name === 'sheet-set-tab-color') {
            if (typeof args.color !== 'string') invalid('color is required; an empty string clears it.');
            value.tab_color = args.color;
        }
    }
    if (['chart-create-basic', 'chart-config-update', 'chart-data-update'].includes(spec.name)) chartInput(spec.name, args, value);
    if (spec.object) objectInput(spec, args, value);
    enrichInput(spec.name, args, value);
    return value;
}
function request(token: string, tool: string, value: JsonObject, write = false): ApiRequest {
    return { method: 'POST', path: `/open-apis/sheet_ai/v2/spreadsheets/${encodeURIComponent(token)}/tools/invoke_${write ? 'write' : 'read'}`, body: { tool_name: tool, input: JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('__')))) } };
}
async function call(client: LarkClient, req: ApiRequest): Promise<any> {
    let response: JsonObject = {};
    for (let attempt = 0; attempt < 3; attempt++) {
        try { response = await client.request(req); break; }
        catch (error) {
            const status = error instanceof ServiceError ? Number(error.details?.upstreamStatus) : 0;
            const transient = error instanceof ServiceError && status !== 429 && (status >= 500 || ['UPSTREAM_UNAVAILABLE', 'OUTCOME_UNCERTAIN'].includes(error.code) || error.details?.reason === 'transient_tool_failure');
            if (!req.path.endsWith('/invoke_read') || !transient || attempt === 2) throw error;
            await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt));
        }
    }
    if (!response.output) return null;
    try { return JSON.parse(typeof response.output === 'string' ? response.output : ''); }
    catch { throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Sheet tool returned invalid JSON output.', 502); }
}
export function sheetsCapabilities(artifacts?: ArtifactStore, workflows?: WorkflowRunner): Capability[] {
    return sheetSpecs.map((spec, index) => ({ definition: sheetsDefinitions[index]!, normalize: (args: JsonObject) => normalizeSheetFlags(spec.name, args),
        preview: async (args, context) => {
            args = normalizeSheetFlags(spec.name, await resolveSheetFiles(spec.name, normalizeSheetFlags(spec.name, args), artifacts, context));
            if (spec.name === 'chart-create' && args['print-example']) return example(args['print-example']);
            const ref = ['workbook-create', 'workbook-import'].includes(spec.name) ? { token: '<new-token>', wiki: false } : locator(args), value = input(spec, args, ref.token);
            if (spec.name === 'styles-put') {
                const operations = value.operations as JsonObject[], requests: ApiRequest[] = [];
                if (value.__needsGrid) requests.push(request(ref.token, 'get_workbook_structure', { excel_id: ref.token }));
                for (let offset = 0; offset < operations.length; offset += 100) requests.push(request(ref.token, 'batch_update', { excel_id: ref.token, operations: operations.slice(offset, offset + 100) }, true));
                return { requests, resumable: true, ...(value.__needsGrid ? { resolution: 'Resolve physical grid dimensions before expanding whole-axis styles; displayed ranges are placeholders.' } : {}) };
            }
            if (['workbook-import', 'workbook-export'].includes(spec.name)) return { resumable: true, arguments: value, phases: spec.name === 'workbook-import' ? ['validate-artifact', 'sniff-container', 'upload', 'create-import', 'poll'] : ['resolve-wiki-if-needed', 'create-export', 'poll', ...(args['output-path'] ? ['save-artifact'] : [])] };
            if (['table-get', 'table-put', 'workbook-create'].includes(spec.name)) return { resumable: true, arguments: args, phases: spec.name === 'table-get' ? ['discover-unless-selector-and-range', 'probe-full-grid', 'read-typed-cells', 'shape-output'] : [...(spec.name === 'workbook-create' ? ['create-workbook', 'adopt-default-sheet'] : []), 'discover-sheets', 'create-missing-sheets', 'probe-append-position', 'write-50000-cell-chunks', 'apply-styles'], ...(ref.wiki ? { resolution: 'Resolve Wiki node before spreadsheet access.' } : {}) };
            if (['filter-update', 'filter-delete'].includes(spec.name) && !value.sheet_id) invalid('Filter update/delete preview requires sheet-id.');
            return { ...(value.__warnings ? { warnings: value.__warnings } : {}), ...(value.__writes_range ? { writes_range: value.__writes_range } : {}), requests: [spec.name === 'dim-move' ? { method: 'POST', path: `/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(ref.token)}/sheets/${encodeURIComponent(String(value.sheet_id || '<resolve-sheet-id>'))}/move_dimension`, body: value.native_body } : request(ref.token, (spec.name === 'dim-delete' && args.ranges !== undefined) || (spec.name === 'cells-set' && args.writes !== undefined) || (spec.tool === 'resize_range' && value.operations) ? 'batch_update' : spec.tool, value, spec.write)], ...(ref.wiki ? { resolution: 'Resolve wiki node to spreadsheet token before invocation.' } : {}), ...(spec.selector && !value.sheet_id && !value.sheet_name ? { selection: 'Resolve the only named workbook sheet before invocation.' } : {}) };
        },
        execute: async (args, context) => {
            args = normalizeSheetFlags(spec.name, await resolveSheetFiles(spec.name, normalizeSheetFlags(spec.name, args), artifacts, context));
            if (spec.name === 'chart-create' && args['print-example']) return example(args['print-example']);
            const ref = ['workbook-create', 'workbook-import'].includes(spec.name) ? { token: '', wiki: false } : locator(args);
            if (args['output-path']) {
                if (!artifacts) throw new ServiceError('ARTIFACT_UNAVAILABLE', 'Artifact storage is not configured.', 503);
                authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
            }
            let token = ref.token;
            input(spec, args, token);
            if (ref.wiki) {
                const result = await context.lark.request({ method: 'GET', path: '/open-apis/wiki/v2/spaces/node_by_token', query: { token } });
                const node = result.node as JsonObject | undefined;
                if (node?.obj_type !== 'sheet' || typeof node?.obj_token !== 'string' || !node.obj_token) invalid('The wiki node must resolve to a spreadsheet.');
                token = node.obj_token;
            }
            if (['workbook-import', 'workbook-export'].includes(spec.name)) {
                if (!workflows) throw new ServiceError('WORKFLOW_UNAVAILABLE', 'Durable workflows are not configured.', 503);
                return workflows.start(`sheets-${spec.name}`, { phase: 'start', args: workbookConversionInput(spec.name, args, token) }, context.selection, context.grant);
            }
            if (['styles-put', 'table-get', 'table-put', 'workbook-create'].includes(spec.name)) {
                if (!workflows) throw new ServiceError('WORKFLOW_UNAVAILABLE', 'Durable workflows are not configured.', 503);
                return workflows.start(`sheets-${spec.name}`, { token, args, offset: 0 }, context.selection, context.grant);
            }
            let value = input(spec, args, token);
            if (spec.selector && !(spec.name === 'cells-set' && args.writes !== undefined) && !value.sheet_id && !value.sheet_name && !clean(args['sheet-id']) && !clean(args['sheet-name'])) {
                const structure = await call(context.lark, request(token, 'get_workbook_structure', { excel_id: token }));
                const entries = Array.isArray(structure) ? structure : structure?.sheets;
                const names = (Array.isArray(entries) ? entries : []).map((entry: JsonObject) => clean(entry.sheet_name) || clean(entry.title)).filter(Boolean);
                if (names.length !== 1) invalid('Specify sheet-id or sheet-name; the workbook does not have exactly one named sheet.');
                value.sheet_name = names[0];
                if ((spec.name === 'dim-delete' && args.ranges !== undefined) || (spec.tool === 'resize_range' && value.operations)) value = input(spec, { ...args, 'sheet-name': names[0] }, token);
            }
            if (['filter-update', 'filter-delete', 'sheet-move', 'dim-move'].includes(spec.name)) {
                if (!value.sheet_id || (spec.name === 'sheet-move' && !Object.hasOwn(args, 'source-index'))) {
                    const structure = await call(context.lark, request(token, 'get_workbook_structure', { excel_id: token }));
                    const entries = Array.isArray(structure) ? structure : structure?.sheets;
                    const found = (Array.isArray(entries) ? entries : []).find((entry: JsonObject) => value.sheet_id ? entry.sheet_id === value.sheet_id : (entry.sheet_name || entry.title) === value.sheet_name);
                    if (!found?.sheet_id) invalid('Could not resolve sheet name to a sheet ID.');
                    value.sheet_id = found.sheet_id; delete value.sheet_name;
                    if (spec.name === 'sheet-move' && !Object.hasOwn(args, 'source-index')) {
                        if (typeof found.index !== 'number' || !Number.isFinite(found.index)) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Sheet structure entry is missing its index.', 502);
                        value.source_index = Math.trunc(found.index);
                    }
                }
                if (spec.name.startsWith('filter-')) value.filter_id = value.sheet_id;
            }
            if (spec.name === 'batch-chart-update' || (spec.name === 'batch-update' && (value.__entries as JsonObject[]).some(entry => ['chart-config-update', 'chart-data-update'].includes(String(entry.name))))) {
                if (!workflows) throw new ServiceError('WORKFLOW_UNAVAILABLE', 'Durable workflows are not configured.', 503);
                return workflows.start('sheets-chart-batch', { token, value, compact: spec.name === 'batch-update', offset: 0 }, context.selection, context.grant);
            }
            if (['chart-config-update', 'chart-data-update'].includes(spec.name)) {
                if (!workflows) throw new ServiceError('WORKFLOW_UNAVAILABLE', 'Durable workflows are not configured.', 503);
                return workflows.start('sheets-chart-update', { token, args, value, name: spec.name }, context.selection, context.grant);
            }
            if (['cells-set-image', 'float-image-create', 'float-image-update'].includes(spec.name) && args.image) {
                if (!workflows) throw new ServiceError('WORKFLOW_UNAVAILABLE', 'Durable workflows are not configured.', 503);
                authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
                return workflows.start('sheets-image', { token, args, value, tool: spec.tool, phase: 'start' }, context.selection, context.grant);
            }
            if (spec.name === 'dim-move') return context.lark.request({ method: 'POST', path: `/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(token)}/sheets/${encodeURIComponent(String(value.sheet_id))}/move_dimension`, body: value.native_body });
            let output = await call(context.lark, request(token, (spec.name === 'dim-delete' && args.ranges !== undefined) || (spec.name === 'cells-set' && args.writes !== undefined) || (spec.tool === 'resize_range' && value.operations) ? 'batch_update' : spec.tool, value, spec.write));
            if (spec.name === 'batch-update' || spec.name === 'batch-chart-create') output = compactBatchOutput(batchOutput(output, value.__batch));
            if (spec.name === 'formula-verify' && args['exit-on-error'] === true) {
                if (output?.status === 'errors_found') throw new ServiceError('FORMULA_ERRORS_FOUND', 'Formula errors were detected. Inspect the report and fix the formulas before retrying.', 422, { report: output });
                if (!['success', 'partial'].includes(output?.status)) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Formula verification returned an unexpected status.', 502);
            }
            if (spec.name === 'sheet-list') {
                if (!Array.isArray(output?.sheets)) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Workbook output did not contain a sheets array.', 502);
                return output.sheets;
            }
            if (spec.name === 'revision-get') {
                if (!output || !Object.hasOwn(output, 'revision')) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Workbook output did not contain a revision.', 502);
                return { revision: output.revision };
            }
            if (value.__writes_range && output && typeof output === 'object') output.writes_range = value.__writes_range;
            const shaped = value.__warnings && output && typeof output === 'object' ? { ...output, warnings: [...(Array.isArray(output.warnings) ? output.warnings : []), ...(value.__warnings as string[])] } : output;
            return readOutput(spec.name, args, shaped, artifacts, context.grant?.id);
        },
    }));
}

export { call as invokeSheetTool };

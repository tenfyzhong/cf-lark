import { assertUniqueChartTargets } from './chart-targets';
import { batchShortcuts } from './generated/batch-shortcuts';
import { normalizeSheetFlags } from './flag-normalization';
import { parseSheetJSON } from './json';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { SheetSpec } from './definitions';
import { jsonArray, splitRange } from './matrices';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
export function batchInput(args: JsonObject, token: string, specs: SheetSpec[], build: (spec: SheetSpec, args: JsonObject, token: string) => JsonObject): JsonObject {
    let payload = args.operations;
    if (typeof payload === 'string') { try { payload = parseSheetJSON(payload); } catch { invalid('operations must contain JSON.'); } }
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) { const envelope = payload as JsonObject; args = { ...args, 'continue-on-error': args['continue-on-error'] ?? envelope.continue_on_error }; payload = envelope.operations; }
    const raw = jsonArray(payload);
    if (!raw.length || raw.length > 100) invalid('Provide one to 100 batch operations.');
    const operations: JsonObject[] = [], indices: number[] = [], failures: JsonObject[] = [], warnings: string[] = [], entries: JsonObject[] = [];
    raw.forEach((entry, index) => {
        let shortcut = '';
        try {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid('Each operation requires shortcut and input.');
            const op = entry as JsonObject;
            shortcut = String(op.shortcut || '').replace(/^\+/, '');
            const spec = specs.find(item => item.name === shortcut);
            if (!spec || !batchShortcuts.includes(shortcut)) invalid('This shortcut cannot be translated into a standalone batch operation.');
            if (Object.keys(op).some(key => !['shortcut', 'input'].includes(key))) invalid('Batch entries contain only shortcut and input.');
            if (op.input != null && (typeof op.input !== 'object' || Array.isArray(op.input))) invalid('Operation input must be an object.');
            const rawInput: JsonObject = { ...(op.input as JsonObject ?? {}) };
            for (const key of Object.keys(rawInput)) if (['url', 'excelid', 'spreadsheettoken', 'token'].includes(key.toLowerCase().replace(/[-_]/g, ''))) delete rawInput[key];
            const input = normalizeSheetFlags(shortcut, rawInput);
            if (input.operation !== undefined || input.writes !== undefined || input.widths !== undefined || input.heights !== undefined || (shortcut === 'dim-delete' && input.ranges !== undefined)) invalid('Nested batch inputs and explicit operation are not supported.');
            if (input.range && typeof input.range === 'string' && !input['sheet-id'] && !input['sheet-name']) {
                const ref = splitRange(input.range);
                if (ref.sheet) { input['sheet-name'] = ref.sheet; input.range = ref.range; }
            }
            if (spec.selector && !input['sheet-id'] && !input['sheet-name']) invalid('Batch suboperations require an explicit sheet selector.');
            if (['float-image-create', 'float-image-update'].includes(shortcut) && input.image) invalid('Batch image uploads require a separate upload first.');
            if (shortcut === 'sheet-move' && (!input['sheet-id'] || input['source-index'] === undefined)) invalid('Batch sheet-move requires sheet-id and source-index.');
            if (['filter-update', 'filter-delete'].includes(shortcut) && !input['sheet-id']) invalid('Filter batch updates require sheet-id.');
            if (['url', 'excel-id', 'spreadsheet-token', 'token'].some(key => input[key] !== undefined)) warnings.push(`operations[${index}]: the top-level workbook locator overrides the suboperation locator.`);
            for (const key of ['url', 'excel-id', 'spreadsheet-token', 'token']) delete input[key];
            const translated = build(spec, input, token);
            if (Array.isArray(translated.__warnings)) warnings.push(...translated.__warnings.map(v => `operations[${index}]: ${v}`));
            operations.push({ tool_name: spec.tool, input: Object.fromEntries(Object.entries(translated).filter(([key]) => !key.startsWith('__'))) });
            indices.push(index); entries.push({ name: shortcut, args: input });
        } catch (error) {
            if (!(error instanceof ServiceError)) throw error;
            failures.push({ index, shortcut: shortcut ? `+${shortcut}` : '', success: false, stage: 'cli_validation', error: error.message });
        }
    });
    assertUniqueChartTargets(entries);
    if (!operations.length || (failures.length && args['continue-on-error'] !== true)) invalid(`Batch validation failed: ${JSON.stringify(failures)}`);
    return { excel_id: token, operations, ...(args['continue-on-error'] === true ? { continue_on_error: true } : {}), __entries: entries, __batch: { indices, failures, total: raw.length }, ...(warnings.length ? { __warnings: warnings } : {}) };
}
export function batchOutput(output: unknown, metadata: unknown): unknown {
    if (!metadata || typeof metadata !== 'object' || !output || typeof output !== 'object' || Array.isArray(output)) return output;
    const { indices, failures, total } = metadata as { indices: number[]; failures: JsonObject[]; total: number };
    const result = output as JsonObject;
    if (!failures.length) return result;
    const results = (Array.isArray(result.results) ? result.results : []).map(item => item && typeof item === 'object' ? { ...item, index: indices[Number(item.index)] ?? item.index } : item);
    results.push(...failures); results.sort((a, b) => Number(a.index) - Number(b.index));
    const succeeded = Number(result.succeeded ?? 0), failed = Number(result.failed ?? 0) + failures.length;
    return { ...result, total, succeeded, failed, results, local_validation_failures: failures, message: `batch_update: ${succeeded} succeeded, ${failed} failed` };
}
export function compactBatchOutput(output: unknown): unknown {
    if (!output || typeof output !== 'object' || Array.isArray(output)) return output;
    const result = structuredClone(output) as JsonObject;
    if (Array.isArray(result.results)) for (const entry of result.results) {
        if (entry && typeof entry === 'object' && entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data)) delete entry.data.snapshot;
    }
    return result;
}

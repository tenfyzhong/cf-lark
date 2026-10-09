import { assertUniqueChartTargets } from './chart-targets';
import { normalizeSheetFlags } from './flag-normalization';
import { parseSheetJSON } from './json';
import type { JsonObject } from '../../domain/models';
import { chartInput, chartInvalid } from './chart-input';
import { chartFlags } from './chart-flags';
import { ServiceError } from '../../domain/errors';
export function chartBatchInput(name: string, args: JsonObject, token: string): JsonObject {
    let raw = args.operations;
    if (typeof raw === 'string') { try { raw = parseSheetJSON(raw); } catch { chartInvalid('operations must be JSON.'); } }
    if (!Array.isArray(raw) && raw && typeof raw === 'object') raw = (raw as JsonObject).operations;
    if (!Array.isArray(raw) || !raw.length || raw.length > 100) chartInvalid('Provide one to 100 chart operations.');
    const operations: JsonObject[] = [], entries: JsonObject[] = [], indices: number[] = [], failures: JsonObject[] = [];
    raw.forEach((item, index) => {
        let shortcut = name === 'batch-chart-create' ? 'chart-create-basic' : '';
        try {
            if (!item || typeof item !== 'object' || Array.isArray(item)) chartInvalid('Each chart operation must be an object.');
            if (item.shortcut) shortcut = String(item.shortcut).replace(/^\+/, '');
            if (name === 'batch-chart-create' ? shortcut !== 'chart-create-basic' : !['chart-config-update', 'chart-data-update'].includes(shortcut)) chartInvalid('Unsupported chart batch shortcut.');
            const rawInput = item.input ?? item;
            const plain: JsonObject = { ...rawInput }; delete plain.shortcut;
            for (const key of Object.keys(plain)) if (['url', 'excelid', 'spreadsheettoken', 'token'].includes(key.toLowerCase().replace(/[-_]/g, ''))) delete plain[key];
            const input = normalizeSheetFlags(shortcut, plain);
            const allowed = new Set([...Object.keys(chartFlags[shortcut]!), 'sheet-id', 'sheet-name', 'url', 'spreadsheet-token', 'token', 'excel-id']);
            if (Object.keys(input).some(key => !allowed.has(key))) chartInvalid('Unknown chart shortcut flag.');
            if (Boolean(input['sheet-id']) === Boolean(input['sheet-name'])) chartInvalid('Every chart operation requires one sheet selector.');
            const value: JsonObject = { excel_id: token, ...(input['sheet-id'] ? { sheet_id: input['sheet-id'] } : { sheet_name: input['sheet-name'] }) };
            chartInput(shortcut, input, value);
            operations.push({ tool_name: 'manage_chart_object', input: value }); entries.push({ name: shortcut, args: input }); indices.push(index);
        } catch (error) { if (!(error instanceof ServiceError)) throw error; failures.push({ index, shortcut: `+${shortcut}`, success: false, stage: 'cli_validation', error: error.message }); }
    });
    assertUniqueChartTargets(entries);
    if (!operations.length || (failures.length && args['continue-on-error'] === false)) chartInvalid(`Chart batch validation failed: ${JSON.stringify(failures)}`);
    return { excel_id: token, operations, continue_on_error: args['continue-on-error'] !== false, __entries: entries, __batch: { indices, failures, total: raw.length } };
}

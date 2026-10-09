import { assertUniqueChartTargets, chartTargetsNeedLookup } from './chart-targets';
import type { WorkflowProgram } from '../../ports/workflows';
import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
import { invokeSheetTool } from './commands';
import { chartPatch, chartSnapshot } from './chart-program';
import { batchOutput, compactBatchOutput } from './batch';
export function chartBatchProgram(): WorkflowProgram {
    return { id: 'sheets-chart-batch', version: 1, domain: 'sheets', risk: 'write', identities: ['user', 'bot'], step: async (state, context) => {
        const token = String(state.token), value = state.value as JsonObject, operations = value.operations as JsonObject[], entries = value.__entries as JsonObject[];
        const offset = Number(state.offset ?? 0), prepared = (state.prepared ?? []) as JsonObject[], indices = (state.indices ?? []) as number[];
        const meta = value.__batch as JsonObject, failures = (state.failures ?? meta.failures) as JsonObject[];
        const call = (tool: string, input: JsonObject, write = false) => invokeSheetTool(context.lark, { method: 'POST', path: `/open-apis/sheet_ai/v2/spreadsheets/${encodeURIComponent(token)}/tools/invoke_${write ? 'write' : 'read'}`, body: { tool_name: tool, input: JSON.stringify(input) } });
        if (!state.targetsChecked && chartTargetsNeedLookup(entries)) {
            const output = await call('get_workbook_structure', { excel_id: token });
            const sheets = (output?.data ?? output)?.sheets ?? [];
            const ids: Record<string, string> = {};
            for (const sheet of sheets) ids[String(sheet.sheet_name ?? sheet.title)] = String(sheet.sheet_id);
            assertUniqueChartTargets(entries, ids);
            return { done: false, state: { ...state, targetsChecked: true } };
        }
        if (offset < operations.length) {
            const operation = operations[offset]!, input = operation.input as JsonObject, entry = entries[offset]!, args = entry.args as JsonObject;
            if (!['chart-config-update', 'chart-data-update'].includes(String(entry.name))) {
                return { done: false, state: { ...state, offset: offset + 1, prepared: [...prepared, operation], indices: [...indices, (meta.indices as number[])[offset]], failures } };
            }
            try {
                const { operation: _, ...read } = input;
                const snapshot = chartSnapshot(await call('get_chart_objects', read), String(input.chart_id));
                const patch = chartPatch(String(entry.name), args, snapshot);
                prepared.push({ tool_name: 'manage_chart_object', input: { ...input, properties: { snapshot: patch.patch, ...(args['last-point-label'] !== undefined ? { last_point_label: args['last-point-label'] } : {}) } } });
                indices.push((meta.indices as number[])[offset]!);
            } catch (error) {
                if (!(error instanceof ServiceError) || !value.continue_on_error) throw error;
                failures.push({ index: (meta.indices as number[])[offset], shortcut: `+${entry.name}`, success: false, stage: 'chart_preflight', error: error.message });
            }
            return { done: false, state: { ...state, offset: offset + 1, prepared, indices, failures } };
        }
        if (!prepared.length) throw new ServiceError('INVALID_ARGUMENTS', 'All chart preflights failed; no writes were sent.', 400, { failures });
        const output = await call('batch_update', { excel_id: token, operations: prepared, continue_on_error: value.continue_on_error }, true);
        const result = batchOutput(output, { ...meta, indices, failures });
        return { done: true, output: state.compact ? compactBatchOutput(result) : result };
    } };
}

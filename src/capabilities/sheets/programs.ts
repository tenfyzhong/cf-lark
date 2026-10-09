import { chartBatchProgram } from './chart-batch-program';
import { workbookConversionPrograms } from './conversions';
import { chartProgram } from './chart-program';
import { tableWritePrograms } from './table-write';
import { imageProgram } from './images';
import { tableReadProgram } from './table-read';
import type { ArtifactStore } from '../../ports/artifacts';
import type { WorkflowProgram } from '../../ports/workflows';
import type { JsonObject } from '../../domain/models';
import { invokeSheetTool } from './commands';
import { stylesPlan, type SheetGrids } from './declarative-styles';
export function sheetsPrograms(artifacts?: ArtifactStore): WorkflowProgram[] {
    return [chartBatchProgram(), ...workbookConversionPrograms(artifacts), chartProgram(), ...tableWritePrograms(), imageProgram(artifacts), tableReadProgram(artifacts), { id: 'sheets-styles-put', version: 1, domain: 'sheets', risk: 'write', identities: ['user', 'bot'],
        step: async (state, context) => {
            const token = String(state.token), args = state.args as JsonObject;
            const plan = stylesPlan(args, token, state.grids as SheetGrids | undefined);
            const path = `/open-apis/sheet_ai/v2/spreadsheets/${encodeURIComponent(token)}/tools/`;
            if (plan.needsGrid && !state.grids) {
                const structure = await invokeSheetTool(context.lark, { method: 'POST', path: `${path}invoke_read`, body: { tool_name: 'get_workbook_structure', input: JSON.stringify({ excel_id: token }) } });
                const grids: SheetGrids = {};
                for (const entry of Array.isArray(structure?.sheets) ? structure.sheets : []) {
                    const name = entry.sheet_name || entry.title;
                    if (typeof name === 'string' && Number.isSafeInteger(entry.row_count) && entry.row_count > 0 && Number.isSafeInteger(entry.column_count) && entry.column_count > 0) grids[name] = { rows: entry.row_count, cols: entry.column_count };
                }
                return { done: false, state: { ...state, grids } };
            }
            const offset = Number(state.offset ?? 0), chunk = plan.operations.slice(offset, offset + 100);
            const output = await invokeSheetTool(context.lark, { method: 'POST', path: `${path}invoke_write`, body: { tool_name: 'batch_update', input: JSON.stringify({ excel_id: token, operations: chunk }) } });
            if (offset + chunk.length < plan.operations.length) return { done: false, state: { ...state, offset: offset + chunk.length } };
            return { done: true, output: plan.operations.length > 100 ? { ...output, batch_requests: Math.ceil(plan.operations.length / 100), warnings: ['Earlier batches are already applied. Reconcile state before retrying merges.'] } : output };
        },
    }];
}

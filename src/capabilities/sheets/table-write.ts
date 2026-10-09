import type { JsonObject } from '../../domain/models';
import type { WorkflowProgram } from '../../ports/workflows';
import { ServiceError } from '../../domain/errors';
import { invokeSheetTool } from './commands';
import { letter, tableMatrix, tableWriteInput, checkTableStyleAnchor, tableCreateDimensions, serializeTableInput } from './table-write-input';
export function tableWritePrograms(): WorkflowProgram[] {
    return [false, true].map(create => ({ id: create ? 'sheets-workbook-create' : 'sheets-table-put', version: 1, domain: 'sheets', risk: 'write' as const, identities: ['user', 'bot'] as const,
        step: async (state, context) => {
            try {
                const args = state.args as JsonObject, sheets = tableWriteInput(args, create);
                const token = String(state.token ?? ''), index = Number(state.index ?? 0), sheet = sheets[index];
                const visualOperations = sheet?.styleOperations.filter(operation => operation.tool_name !== 'set_cell_range') ?? [];
                const visualOnly = create && args.sheets === undefined && !!sheet && (!sheet.columns.length || !sheet.data.length);
                const next = (patch: JsonObject) => ({ done: false as const, state: { ...state, ...patch } });
                const call = (tool: string, input: JsonObject, write = false) => invokeSheetTool(context.lark, { method: 'POST', path: `/open-apis/sheet_ai/v2/spreadsheets/${encodeURIComponent(token)}/tools/invoke_${write ? 'write' : 'read'}`, body: { tool_name: tool, input: serializeTableInput({ excel_id: token, ...input }) } });
                const finish = (written: unknown[]) => ({ done: true as const, output: { ...(create ? { spreadsheet: state.spreadsheet } : { spreadsheet_token: token }), ...(!visualOnly ? { sheets: written } : {}) } });
                if (create && !token) {
                    const response = await context.lark.request({ method: 'POST', path: '/open-apis/sheets/v3/spreadsheets', body: { title: String(args.title).trim(), ...(args['folder-token'] ? { folder_token: args['folder-token'] } : {}) } });
                    const spreadsheet = response.spreadsheet as JsonObject, createdToken = spreadsheet?.spreadsheet_token || spreadsheet?.token;
                    if (!createdToken) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Workbook was created but no token was returned.', 502);
                    if (!sheets.length && args.styles === undefined) return { done: true, output: { spreadsheet } };
                    return next({ token: createdToken, spreadsheet, phase: 'discover' });
                }
                if (!state.targets || state.phase === 'discover') {
                    const output = await call('get_workbook_structure', {});
                    if (!Array.isArray(output?.sheets)) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'No sheet structure returned.', 502);
                    return next({ targets: output.sheets, phase: create && !state.adopted && sheet && !visualOnly ? 'adopt' : 'write' });
                }
                let targets = state.targets as JsonObject[];
                if (state.phase === 'adopt') {
                    if (targets.some(target => (target.sheet_name || target.title) === sheet!.name)) return next({ adopted: true, phase: 'write' });
                    const first = targets[0];
                    if (!first?.sheet_id) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'New workbook has no default sheet.', 502);
                    if (first.sheet_name !== sheet!.name) await call('modify_workbook_structure', { operation: 'rename', sheet_id: first.sheet_id, new_name: sheet!.name }, true);
                    targets = [{ ...first, sheet_name: sheet!.name }, ...targets.slice(1)];
                    return next({ targets, adopted: true, phase: 'write' });
                }
                if (!sheet) return finish((state.written ?? []) as unknown[]);
                const advance = (written: unknown[]) => {
                    if (index + 1 === sheets.length) return finish(written);
                    const nextState: JsonObject = { ...state, index: index + 1, written, phase: 'write' };
                    for (const key of ['rowOffset', 'writes', 'baseRow', 'appendEmpty', 'pendingCreate', 'styleOffset', 'pendingSummary', 'visualSheetId']) delete nextState[key];
                    return { done: false as const, state: nextState };
                };
                if (state.phase === 'visual') {
                    const offset = Number(state.styleOffset ?? 0);
                    const operations = visualOperations.slice(offset, offset + 100).map(operation => {
                        const input: JsonObject = { ...(operation.input as JsonObject), excel_id: token };
                        if (state.visualSheetId) { delete input.sheet_name; input.sheet_id = state.visualSheetId; }
                        return { ...operation, input };
                    });
                    await call('batch_update', { operations }, true);
                    return offset + 100 < visualOperations.length ? next({ styleOffset: offset + 100 }) : advance([...(state.written as unknown[] ?? []), state.pendingSummary]);
                }
                const target = visualOnly ? targets[0] : targets.find(t => (t.sheet_name || t.title) === sheet.name);
                if (!target) {
                    if (state.pendingCreate === sheet.name) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Created sheet was not returned by the structure lookup. Reconcile before retrying.', 502);
                    checkTableStyleAnchor(sheet);
                    await call('modify_workbook_structure', { operation: 'create', sheet_name: sheet.name, ...tableCreateDimensions(sheet) }, true);
                    return next({ pendingCreate: sheet.name, phase: 'discover' });
                }
                if (visualOnly) return visualOperations.length ? next({ phase: 'visual', visualSheetId: target.sheet_id }) : finish([]);
                let baseRow = Number(state.baseRow ?? sheet.start.row), header = sheet.header ?? sheet.mode !== 'append';
                if (sheet.mode === 'append' && state.baseRow === undefined) {
                    const output = await call('get_range_as_csv', { sheet_id: target.sheet_id, range: Number(target.row_count) > 0 && Number(target.column_count) > 0 ? `A1:${letter(Number(target.column_count))}${target.row_count}` : 'A1', max_rows: 1000000000, max_chars: 500000 });
                    if (output?.truncated || output?.has_more || output?.is_truncated) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Append position probe was truncated; no rows were written.', 502);
                    const region = String(output?.current_region || output?.actual_range || ''), match = /([1-9][0-9]*)$/.exec(region);
                    baseRow = match ? Number(match[1]) + 1 : sheet.start.row;
                    return next({ baseRow, appendEmpty: !region });
                }
                if (sheet.mode === 'append' && state.appendEmpty && sheet.header === undefined) header = true;
                const matrix = tableMatrix(sheet, header, baseRow), offset = Number(state.rowOffset ?? 0), width = matrix[0]?.length ?? sheet.columns.length;
                const chunk = matrix.slice(offset, offset + Math.max(1, Math.floor(50000 / Math.max(1, width))));
                const startCol = letter(sheet.start.col), endCol = letter(sheet.start.col + width - 1);
                if (chunk.length) await call('set_cell_range', { sheet_id: target.sheet_id, range: `${startCol}${baseRow + offset}:${endCol}${baseRow + offset + chunk.length - 1}`, cells: chunk, ...(sheet.allowOverwrite === false ? { allow_overwrite: false } : {}) }, true);
                const writes = Number(state.writes ?? 0) + (chunk.length ? 1 : 0);
                if (offset + chunk.length < matrix.length) return next({ rowOffset: offset + chunk.length, writes });
                const summary = { name: sheet.name, sheet_id: target.sheet_id, range: matrix.length ? `${startCol}${baseRow}:${endCol}${baseRow + matrix.length - 1}` : '', data_rows: sheet.data.length, columns: width, writes, mode: sheet.mode };
                if (visualOperations.length) return next({ phase: 'visual', pendingSummary: summary, visualSheetId: target.sheet_id });
                return advance([...(state.written as unknown[] ?? []), summary]);
            } catch (error) {
                const written = state.written as unknown[] ?? [];
                if (!(error instanceof ServiceError) || error.code === 'OUTCOME_UNCERTAIN' || (!written.length && !(create && state.token))) throw error;
                return { done: true, output: { ok: false, spreadsheet_token: state.token, ...(create ? { spreadsheet: state.spreadsheet } : {}), written_sheets: written,
                    reason: create ? `The spreadsheet exists but its initial fill failed: ${error.message}` : error.message,
                    cause: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
                    hint: 'Inspect the completed sheets and retry only the remaining fill, or delete the spreadsheet.' } };
            }
        },
    }));
}

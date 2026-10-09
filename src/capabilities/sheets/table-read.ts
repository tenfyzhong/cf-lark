import type { JsonObject } from '../../domain/models';
import type { WorkflowProgram } from '../../ports/workflows';
import type { ArtifactStore } from '../../ports/artifacts';
import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import { invokeSheetTool } from './commands';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function clipped(value: any): boolean { return !!value && (['truncated', 'has_more', 'is_truncated'].some(key => value[key] === true) || (Array.isArray(value.ranges) && value.ranges.some(clipped))); }
function column(n: number): string { let text = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + (n - 1) % 26) + text; return text; }
function dateFormat(format: string): boolean {
    const value = format.toLowerCase();
    if (value.includes(':') && !/[yd/.-]/.test(value)) return false;
    let quoted = false, bracketed = false, escaped = false, calendar = false, clock = false, allowed = true, effective = false;
    for (let index = 0; index < value.length; index++) {
        const char = value[index]!;
        if (escaped) { escaped = false; continue; }
        if (char === '\\') escaped = true;
        else if (!bracketed && char === '"') quoted = !quoted;
        else if (!quoted && char === '[') bracketed = true;
        else if (!quoted && char === ']') bracketed = false;
        else if (!quoted && !bracketed) {
            if (value.startsWith('am/pm', index)) { effective = true; index += 4; continue; }
            if (char === 'y' && value[index + 1] === 'y') return true;
            effective = true;
            if (char === 'y' || char === 'd') calendar = true;
            else if (char === 'm') { if (!clock) calendar = true; }
            else if (char === 'h' || char === 's') clock = true;
            else if (!/[ap0-9/\-:., ]/.test(char)) allowed = false;
        }
    }
    return effective && allowed && calendar;
}
function text(value: unknown): string { return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value); }
function spec(name: string, range: string, output: any, noHeader: boolean): JsonObject {
    const grid: any[][] = Array.isArray(output?.ranges?.[0]?.cells) ? output.ranges[0].cells : [];
    const truncated = clipped(output), extra = truncated ? { truncated: true, truncation_warning: 'The read hit max-chars. Increase the budget or read a narrower range.' } : {};
    if (!grid.length) return { name, range: '', columns: [], data: [], dtypes: {}, ...extra };
    const rows = noHeader ? grid : grid.slice(1), width = Math.max(...grid.map(row => row.length));
    const names: string[] = [], types: string[] = [], dtypes: JsonObject = {}, formats: JsonObject = {};
    for (let c = 0; c < width; c++) {
        const header = noHeader ? null : grid[0]?.[c]?.value;
        const label = header === undefined || header === null || header === '' ? `col${c + 1}` : text(header);
        if (names.includes(label)) invalid(`Sheet ${name} has duplicate header ${label}; use no-header to read by position.`);
        names.push(label);
        const seen = new Set<string>(); let numberFormat = '', dayFormat = '';
        for (const row of rows) {
            const cell = row[c], value = cell?.value, format = String(cell?.cell_styles?.number_format ?? '');
            if (value === null || value === undefined || value === '') continue;
            if (dateFormat(format) && typeof value === 'number') { seen.add('date'); dayFormat ||= format; }
            else if (format.trim() === '@') seen.add('string');
            else if (typeof value === 'number') { seen.add('number'); numberFormat ||= format; }
            else seen.add(typeof value === 'boolean' ? 'bool' : 'string');
        }
        const type = seen.size === 1 ? [...seen][0]! : 'string'; types.push(type);
        dtypes[label] = ({ date: 'datetime64[ns]', number: 'float64', bool: 'bool' } as Record<string, string>)[type] ?? 'object';
        const format = type === 'date' ? dayFormat : type === 'number' ? numberFormat : '';
        if (format && format !== '@') formats[label] = format;
    }
    const data = rows.map(row => names.map((_, c) => {
        const value = row[c]?.value;
        if (value === undefined || value === null || value === '') return null;
        if (types[c] === 'date') return new Date(Date.UTC(1899, 11, 30) + Math.trunc(Number(value) * 86400000)).toISOString().slice(0, 10);
        return types[c] === 'string' ? text(value) : value;
    }));
    return { name, range, columns: names, data, dtypes, ...(Object.keys(formats).length ? { formats } : {}), ...extra };
}
export function tableReadProgram(artifacts?: ArtifactStore): WorkflowProgram {
    return { id: 'sheets-table-get', version: 1, domain: 'sheets', risk: 'read', identities: ['user', 'bot'],
        step: async (state, context) => {
            const token = String(state.token), args = state.args as JsonObject, offload = !!args['output-path'];
            if (offload) {
                if (!artifacts) throw new ServiceError('ARTIFACT_UNAVAILABLE', 'Artifact storage is not configured.', 503);
                for (const risk of ['read', 'write'] as const) authorize(context.grant, { ...context.selection, domain: 'artifact', risk }, Date.now());
            }
            const call = (tool: string, input: JsonObject) => invokeSheetTool(context.lark, { method: 'POST', path: `/open-apis/sheet_ai/v2/spreadsheets/${encodeURIComponent(token)}/tools/invoke_read`, body: { tool_name: tool, input: JSON.stringify({ excel_id: token, ...input }) } });
            const id = args['sheet-id'], name = args['sheet-name'], userRange = String(args.range ?? '');
            if (id && name) invalid('sheet-id and sheet-name are mutually exclusive.');
            let targets = state.targets as JsonObject[] | undefined;
            if (!targets && userRange && (id || name)) targets = [{ ...(id ? { sheet_id: id } : { sheet_name: name }) }];
            if (!targets) {
                const structure = await call('get_workbook_structure', {});
                targets = (Array.isArray(structure?.sheets) ? structure.sheets : []).filter((entry: any) => entry.sheet_id).map((entry: any) => ({ sheet_id: entry.sheet_id, sheet_name: entry.sheet_name || entry.title || '', row_count: entry.row_count ?? 0, column_count: entry.column_count ?? 0 }));
                if (id || name) targets = targets!.filter(entry => id ? entry.sheet_id === id : entry.sheet_name === name);
                if (!targets!.length) invalid('No matching sheets were found.');
                return { done: false, state: { ...state, targets: targets!, offset: 0 } };
            }
            const offset = Number(state.offset ?? 0), target = targets[offset]!, sheets = (state.sheets ?? []) as JsonObject[];
            const budget = Number(args['max-chars']) > 0 ? Number(args['max-chars']) : offload ? 20000000 : 500000;
            const remaining = budget - Number(state.consumed ?? 0);
            const finish = (values: JsonObject[], incomplete = false): JsonObject => ({ sheets: values, ...(offload ? { artifact_manifest: true } : {}), ...(incomplete ? { truncated: true, unread_sheets: targets!.slice(offset).map(entry => entry.sheet_name || entry.sheet_id), truncation_warning: 'The workbook character budget was exhausted.' } : {}) });
            if (remaining <= 0) return { done: true, output: finish(sheets, true) };
            const selector = target.sheet_id ? { sheet_id: target.sheet_id } : { sheet_name: target.sheet_name };
            let region = userRange || (typeof state.region === 'string' ? state.region : undefined);
            if (region === undefined) {
                const fullGrid = Number(target.row_count) > 0 && Number(target.column_count) > 0 ? `A1:${column(Number(target.column_count))}${target.row_count}` : 'A1';
                const probe = await call('get_range_as_csv', { ...selector, range: fullGrid, max_rows: 1000000000, max_chars: remaining });
                if (clipped(probe)) invalid('The used-region probe was truncated; increase max-chars or specify range.');
                region = String(probe?.current_region || probe?.actual_range || '');
                return { done: false, state: { ...state, targets, region, offset } };
            }
            const output = region ? await call('get_cell_ranges', { ...selector, ranges: [region], include_styles: true, value_render_option: 'raw_value', cell_limit: 1000000000, max_chars: remaining }) : {};
            const table = spec(String(target.sheet_name ?? ''), region, output, args['no-header'] === true);
            const encoded = JSON.stringify(table), consumed = Number(state.consumed ?? 0) + new TextEncoder().encode(encoded).byteLength;
            let entry = table;
            if (offload) {
                const body = new Blob([encoded + '\n'], { type: 'application/json' });
                const artifact = await artifacts!.upload(context.grant.id, body.size, body.stream());
                entry = { name: table.name, range: table.range, artifactId: artifact.id, output_path: `/mcp/artifacts/${artifact.id}`, bytes_written: body.size, complete: !table.truncated };
            }
            const collected = [...sheets, entry];
            if (offset + 1 === targets.length) return { done: true, output: finish(collected) };
            const next: JsonObject = { ...state, targets, offset: offset + 1, sheets: collected, consumed };
            delete next.region;
            return { done: false, state: next };
        },
    };
}

import { describe, it, expect, vi } from 'vitest';
import { sheetsCapabilities } from '../src/capabilities/sheets/commands';
import type { CommandContext } from '../src/ports/capabilities';
const get = (id: string) => sheetsCapabilities().find(c => c.definition.id === `sheets.+${id}`)!;
const context = (request: ReturnType<typeof vi.fn>) => ({ lark: { request } } as unknown as CommandContext);
describe('Sheets shortcut contracts', () => {
    it('projects workbook sheets and revision from encoded tool output', async () => {
        const request = vi.fn().mockResolvedValue({ output: JSON.stringify({ sheets: [{ title: 'Data' }], revision: 7 }) });
        expect(await get('sheet-list').execute({ token: 'abc' }, context(request))).toEqual([{ title: 'Data' }]);
        expect(await get('revision-get').execute({ 'spreadsheet-token': 'abc' }, context(request))).toEqual({ revision: 7 });
        expect(request.mock.calls[0]![0]).toEqual({ method: 'POST', path: '/open-apis/sheet_ai/v2/spreadsheets/abc/tools/invoke_read', body: { tool_name: 'get_workbook_structure', input: '{"excel_id":"abc"}' } });
    });
    it('resolves wiki then the sole sheet before object list', async () => {
        const request = vi.fn().mockResolvedValueOnce({ node: { obj_type: 'sheet', obj_token: 'book' } }).mockResolvedValueOnce({ output: '{"sheets":[{"title":"Only"}]}' }).mockResolvedValueOnce({ output: '[{"id":"chart"}]' });
        expect(await get('chart-list').execute({ url: 'https://example.com/wiki/node', 'chart-id': ' c ' }, context(request))).toEqual([{ id: 'chart' }]);
        expect(JSON.parse(request.mock.calls[2]![0].body.input)).toEqual({ excel_id: 'book', sheet_name: 'Only', chart_id: 'c' });
        expect(request.mock.calls[0]![0].path).toBe('/open-apis/wiki/v2/spaces/node_by_token');
    });
    it('rejects ambiguous selectors without issuing the final read', async () => {
        const request = vi.fn().mockResolvedValue({ output: '{"sheets":[{"title":"A"},{"title":"B"}]}' });
        await expect(get('chart-list').execute({ token: 'book' }, context(request))).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('validates offline and preserves explicitly supplied history pagination', async () => {
        await expect(get('workbook-info').preview({ token: 'a', url: 'https://example.com/sheets/b' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(get('changeset-get').preview({ token: 'a', 'start-revision': 1, 'end-revision': 21 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        const value = await get('history-list').preview({ token: 'a', 'end-version': 0 }) as any;
        expect(JSON.parse(value.requests[0].body.input)).toEqual({ excel_id: 'a', end_version: 0 });
    });
    it('rejects malformed output and missing projections', async () => {
        await expect(get('workbook-info').execute({ token: 'a' }, context(vi.fn().mockResolvedValue({ output: 'oops' })))).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
        await expect(get('revision-get').execute({ token: 'a' }, context(vi.fn().mockResolvedValue({ output: '{}' })))).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
    });
});

describe('Sheets structure writes', () => {
    it('preserves pinned create defaults and explicit zero dimensions', async () => {
        const preview = await get('sheet-create').preview({ token: 'book', title: 'New' }) as any;
        expect(JSON.parse(preview.requests[0].body.input)).toEqual({ excel_id: 'book', operation: 'create', sheet_name: 'New', rows: 200, columns: 20 });
        const zero = await get('sheet-create').preview({ token: 'book', title: 'New', 'row-count': 0, 'col-count': 0, index: 0 }) as any;
        expect(JSON.parse(zero.requests[0].body.input)).toEqual({ excel_id: 'book', operation: 'create', sheet_name: 'New', target_index: 0 });
    });
    it('requires an explicit deletion target and permits clearing tab color', async () => {
        await expect(get('sheet-delete').preview({ token: 'book' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        const value = await get('sheet-set-tab-color').preview({ token: 'book', 'sheet-id': 's', color: '' }) as any;
        expect(JSON.parse(value.requests[0].body.input)).toMatchObject({ operation: 'set_tab_color', tab_color: '' });
    });
    it.each(['sheet-hide', 'sheet-unhide', 'sheet-show-gridline', 'sheet-hide-gridline', 'sheet-copy', 'sheet-rename'])('executes %s through write endpoint without retry', async name => {
        const request = vi.fn().mockResolvedValue({ output: '{"revision":8}' });
        expect(await get(name).execute({ token: 'book', 'sheet-id': 's', ...(['sheet-copy', 'sheet-rename'].includes(name) ? { title: 'New' } : {}) }, context(request))).toEqual({ revision: 8 });
        expect(request).toHaveBeenCalledTimes(1);
        expect(request.mock.calls[0]![0].path).toContain('/invoke_write');
    });
});

describe('Sheets dimension and range semantics', () => {
    it('maps inherited style to the preceding anchor', async () => {
        const result = await get('dim-insert').preview({ token: 'a', 'sheet-id': 's', position: 'AA', count: 2, 'inherit-style': 'before' }) as any;
        expect(JSON.parse(result.requests[0].body.input)).toMatchObject({ position: 'Z', count: 2, side: 'after', operation: 'insert' });
    });
    it('freezes both axes in one operation and rejects mixed forms', async () => {
        const result = await get('dim-freeze').preview({ token: 'a', 'sheet-id': 's', rows: 1, cols: 2 }) as any;
        expect(JSON.parse(result.requests[0].body.input)).toMatchObject({ freeze_rows: 1, freeze_columns: 2, operation: 'freeze' });
        await expect(get('dim-freeze').preview({ token: 'a', rows: 1, dimension: 'row', count: 1 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('maps clear and merge vocabularies', async () => {
        const clear = await get('cells-clear').preview({ token: 'a', 'sheet-id': 's', range: 'A1:B2' }) as any;
        expect(JSON.parse(clear.requests[0].body.input)).toMatchObject({ range: 'A1:B2', clear_type: 'contents' });
        const merge = await get('cells-merge').preview({ token: 'a', 'sheet-id': 's', range: 'A1:B2' }) as any;
        expect(JSON.parse(merge.requests[0].body.input)).toMatchObject({ range: 'A1:B2', operation: 'merge', merge_type: 'all' });
    });
    it('maps sheet include groups and splits dropdown ranges', async () => {
        const info = await get('sheet-info').preview({ token: 'a', 'sheet-id': 's', include: ['row_heights', 'col_widths'] }) as any;
        expect(JSON.parse(info.requests[0].body.input)).toMatchObject({ info_type: 'row_heights_column_widths' });
        const dropdown = await get('dropdown-get').preview({ token: 'a', 'sheet-id': 's', range: 'A1:A2,C1:C2' }) as any;
        expect(JSON.parse(dropdown.requests[0].body.input)).toMatchObject({ ranges: ['A1:A2', 'C1:C2'], include_styles: false, value_render_option: 'formatted_value' });
    });
});

describe('Sheets object contracts', () => {
    it.each([['chart', 'chart-id', 'chart_id'], ['pivot', 'pivot-table-id', 'pivot_table_id'], ['cond-format', 'rule-id', 'conditional_format_id'], ['sparkline', 'group-id', 'group_id'], ['filter-view', 'view-id', 'view_id'], ['float-image', 'float-image-id', 'float_image_id']])('deletes %s by its exact object id', async (name, flag, field) => {
        const value = await get(`${name}-delete`).preview({ token: 'a', 'sheet-id': 's', [flag]: 'id' }) as any;
        expect(JSON.parse(value.requests[0].body.input)).toMatchObject({ operation: 'delete', [field]: 'id' });
        await expect(get(`${name}-delete`).preview({ token: 'a', 'sheet-id': 's' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('validates properties before requests and preserves JSON object updates', async () => {
        await expect(get('chart-update').preview({ token: 'a', 'sheet-id': 's', 'chart-id': 'c', properties: [] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        const result = await get('chart-update').preview({ token: 'a', 'sheet-id': 's', 'chart-id': 'c', properties: '{}' }) as any;
        expect(JSON.parse(result.requests[0].body.input)).toMatchObject({ operation: 'update', chart_id: 'c', properties: {} });
    });
    it('rejects mismatched conditional-format attribute shape and missing sparkline IDs', async () => {
        await expect(get('cond-format-update').preview({ token: 'a', 'sheet-id': 's', 'rule-id': 'r', properties: { rule_type: 'colorScale', attrs: [{ compare_type: 'equal', value: '1' }] } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(get('sparkline-update').preview({ token: 'a', 'sheet-id': 's', 'group-id': 'g', properties: { sparklines: [{ data_range: 'A1:A2', location: 'B1' }] } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

describe('Sheets cell reads', () => {
    it('uses include switches and preserves an explicit character cap', async () => {
        const value = await get('cells-get').preview({ token: 'a', 'sheet-id': 's', range: 'A1:B2', include: ['formula', 'conditional_format', 'truncation'], 'max-chars': 1000 }) as any;
        expect(JSON.parse(value.requests[0].body.input)).toMatchObject({ cell_limit: 1000000000, max_chars: 1000, include_styles: true, include_conditional_format_style: true, include_truncation_info: true, value_render_option: 'formula' });
    });
    it('reads the full sheet as CSV and strips only row prefixes when requested', async () => {
        const request = vi.fn().mockResolvedValue({ output: '{"annotated_csv":"[row=1],A,B\\n[row=2],1,2","revision":2}' });
        expect(await get('csv-get').execute({ token: 'a', 'sheet-id': 's', 'include-row-prefix': false }, context(request))).toEqual({ annotated_csv: 'A,B\n1,2', revision: 2 });
        expect(JSON.parse(request.mock.calls[0]![0].body.input)).toMatchObject({ range: 'A:ZZZ', max_chars: 500000, max_rows: 1000000000 });
    });
    it('offloads a read as an owned artifact and reports nested truncation', async () => {
        const upload = vi.fn().mockResolvedValue({ id: 'artifact', size: 70, expiresAt: 999 });
        const capability = sheetsCapabilities({ upload, read: vi.fn(), remove: vi.fn() }).find(c => c.definition.id === 'sheets.+cells-get')!;
        const ctx = { lark: { request: vi.fn().mockResolvedValue({ output: '{"ranges":[{"truncated":true}]}' }) }, selection: { profileId: 'p', accountId: 'a', identity: 'user' }, grant: { id: 'g', revoked: false, expiresAt: Date.now() + 60000, domains: ['sheets', 'artifact'], permissions: ['read', 'write'], profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }] } } as CommandContext;
        const result = await capability.execute({ token: 'book', 'sheet-id': 's', range: 'A1', 'output-path': 'result.json' }, ctx);
        expect(result).toMatchObject({ artifactId: 'artifact', complete: false, truncated: true });
        expect(upload.mock.calls[0]![0]).toBe('g');
    });
});

describe('Sheets pivot and filter placement', () => {
    it('does not resolve a placement sheet for pivot create', async () => {
        const request = vi.fn().mockResolvedValue({ output: '{"id":"pivot"}' });
        await get('pivot-create').execute({ token: 'a', properties: {} }, context(request));
        expect(request).toHaveBeenCalledTimes(1);
        expect(JSON.parse(request.mock.calls[0]![0].body.input)).toEqual({ excel_id: 'a', operation: 'create', properties: {} });
        await expect(get('pivot-create').preview({ token: 'a', properties: {}, 'target-position': 'B2', range: 'C3' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('initializes empty filter rules and binds delete filter_id to resolved sheet', async () => {
        const create = await get('filter-create').preview({ token: 'a', 'sheet-id': 's', range: 'A1:C4' }) as any;
        expect(JSON.parse(create.requests[0].body.input)).toMatchObject({ operation: 'create', properties: { range: 'A1:C4', rules: [] } });
        const request = vi.fn().mockResolvedValueOnce({ output: '{"sheets":[{"sheet_name":"Data","sheet_id":"s"}]}' }).mockResolvedValueOnce({ output: '{}' });
        await get('filter-delete').execute({ token: 'a', 'sheet-name': 'Data' }, context(request));
        expect(JSON.parse(request.mock.calls[1]![0].body.input)).toMatchObject({ sheet_id: 's', filter_id: 's', operation: 'delete' });
        await expect(get('filter-delete').preview({ token: 'a', 'sheet-name': 'Data' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

describe('Sheets moves', () => {
    it('resolves sheet move source index from structure', async () => {
        const request = vi.fn().mockResolvedValueOnce({ output: '{"sheets":[{"sheet_name":"Data","sheet_id":"s","index":2}]}' }).mockResolvedValueOnce({ output: '{}' });
        await get('sheet-move').execute({ token: 'a', 'sheet-name': 'Data', index: 0 }, context(request));
        expect(JSON.parse(request.mock.calls[1]![0].body.input)).toEqual({ excel_id: 'a', operation: 'move', sheet_id: 's', source_index: 2, target_index: 0 });
    });
    it('converts dimension indices and rejects mixed axes before network', async () => {
        const request = vi.fn().mockResolvedValue({ moved: true });
        expect(await get('dim-move').execute({ token: 'a', 'sheet-id': 's', 'source-range': 'C:F', target: 'H' }, context(request))).toEqual({ moved: true });
        expect(request.mock.calls[0]![0]).toEqual({ method: 'POST', path: '/open-apis/sheets/v3/spreadsheets/a/sheets/s/move_dimension', body: { source: { major_dimension: 'COLUMNS', start_index: 2, end_index: 5 }, destination_index: 7 } });
        await expect(get('dim-move').preview({ token: 'a', 'source-range': 'C:F', target: '3' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

describe('Sheets search and floating image update', () => {
    it('preserves empty replacement and flattens search flags', async () => {
        const result = await get('cells-replace').preview({ token: 'a', 'sheet-id': 's', find: ' x ', replacement: '', regex: true, 'include-formulas': true }) as any;
        expect(JSON.parse(result.requests[0].body.input)).toMatchObject({ search_term: ' x ', replace_term: '', options: { use_regex: true, match_formulas: true } });
        await expect(get('cells-replace').preview({ token: 'a', find: 'x' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        const search = await get('cells-search').preview({ token: 'a', 'sheet-id': 's', find: 'x', offset: 3 }) as any;
        expect(JSON.parse(search.requests[0].body.input)).toMatchObject({ offset: 3, max_matches: 5000 });
    });
    it('updates complete image geometry without replacing the source', async () => {
        const result = await get('float-image-update').preview({ token: 'a', 'sheet-id': 's', 'float-image-id': 'f', 'image-name': 'Image', 'position-row': 1, 'position-col': 'A', 'size-width': 100, 'size-height': 200, 'offset-row': 0, 'z-index': 0 }) as any;
        expect(JSON.parse(result.requests[0].body.input)).toMatchObject({ operation: 'update', float_image_id: 'f', properties: { image_name: 'Image', position: { row: 1, col: 'A' }, size: { width: 100, height: 200 }, offset: { row_offset: 0 }, z_index: 0 } });
    });
});

describe('Sheets range transforms', () => {
    it.each([['range-copy', { 'paste-type': 'values' }, { paste_type: 'value_only' }], ['range-move', { 'target-sheet-id': 'other' }, { destination_sheet_id: 'other' }], ['range-fill', { 'series-type': 'copy' }, { fill_type: 'copyCells' }]])('maps %s options', async (name, options, expected) => {
        const result = await get(name).preview({ token: 'a', 'sheet-id': 's', 'source-range': 'A1:B2', 'target-range': 'C1:D2', ...options }) as any;
        expect(JSON.parse(result.requests[0].body.input)).toMatchObject({ range: 'A1:B2', destination_range: 'C1:D2', ...expected });
    });
    it('validates sort keys and preserves explicit false direction', async () => {
        const result = await get('range-sort').preview({ token: 'a', 'sheet-id': 's', range: 'A1:C10', 'sort-keys': [{ column: 'B', ascending: false }], 'has-header': true }) as any;
        expect(JSON.parse(result.requests[0].body.input)).toMatchObject({ sort_conditions: [{ column: 'B', ascending: false }], has_header: true });
        await expect(get('range-sort').preview({ token: 'a', range: 'A1:C10', 'sort-keys': [{ column: 'B' }] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

describe('Sheets dropdown matrices', () => {
    it('preserves highlight false and stamps one validation per destination cell', async () => {
        const result = await get('dropdown-set').preview({ token: 'a', 'sheet-id': 's', range: 'A1:B2', options: ['Open', 'Done'], highlight: false }) as any;
        const input = JSON.parse(result.requests[0].body.input);
        expect(input.cells).toHaveLength(2);
        expect(input.cells[0]).toHaveLength(2);
        expect(input.cells[0][0]).toEqual({ data_validation: { type: 'list', items: ['Open', 'Done'], enable_highlight: false } });
    });
    it('uses atomic prefixed-range updates and bounds allocation', async () => {
        const result = await get('dropdown-delete').preview({ token: 'a', ranges: ["'My Sheet'!A1:B1", 'Other!C3'] }) as any;
        const input = JSON.parse(result.requests[0].body.input);
        expect(input.operations[0]).toMatchObject({ tool_name: 'set_cell_range', input: { sheet_name: 'My Sheet', range: 'A1:B1', cells: [[{ data_validation: null }, { data_validation: null }]] } });
        await expect(get('dropdown-set').preview({ token: 'a', 'sheet-id': 's', range: 'A1:ZZ1000000', options: ['Open'] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

describe('Sheets scattered dimension deletion', () => {
    it('orders nonoverlapping spans descending and rejects overlap', async () => {
        const result = await get('dim-delete').preview({ token: 'a', 'sheet-id': 's', ranges: ['3:4', '10:11', '7'] }) as any;
        expect(result.requests[0].body.tool_name).toBe('batch_update');
        expect(JSON.parse(result.requests[0].body.input).operations.map((op: any) => op.input.range)).toEqual(['10:11', '7', '3:4']);
        await expect(get('dim-delete').preview({ token: 'a', 'sheet-id': 's', ranges: ['3:5', '5:6'] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

describe('Sheets cell matrix writes', () => {
    it('expands anchors, pads ragged rows, and rejects oversized matrices', async () => {
        const result = await get('cells-set').preview({ token: 'a', 'sheet-id': 's', range: 'B2', cells: [[{ value: 'a' }, { formula: '=1+1' }], [{ value: 2 }, {}]] }) as any;
        expect(JSON.parse(result.requests[0].body.input)).toMatchObject({ range: 'B2:C3' });
        await expect(get('cells-set').preview({ token: 'a', 'sheet-id': 's', range: 'A1:A2', cells: [[1, 2], [3, 4]] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        const padded: any = await get('cells-set').preview({ token: 'a', 'sheet-id': 's', range: 'A1', cells: [[1], [2, 3]] });
        expect(JSON.parse(padded.requests[0].body.input).cells).toEqual([[{ value: 1 }, {}], [{ value: 2 }, { value: 3 }]]);
    });
    it('builds scattered writes atomically and preserves narrowed-range warning', async () => {
        const request = vi.fn().mockResolvedValue({ output: '{"revision":9}' });
        const result = await get('cells-set').execute({ token: 'a', writes: [{ sheet_name: 'Data', range: 'A1:B2', cells: [[{ value: 1 }]] }, { sheet_name: 'Other', range: 'C3', cells: [[{ value: 2 }]] }] }, context(request)) as any;
        expect(request).toHaveBeenCalledTimes(1);
        expect(request.mock.calls[0]![0].body.tool_name).toBe('batch_update');
        expect(result.warnings[0]).toContain('A1');
    });
});

describe('Sheets style and clear batches', () => {
    it('stamps style without cell values and expands all borders', async () => {
        const result = await get('cells-set-style').preview({ token: 'a', 'sheet-id': 's', range: 'A1:B1', 'font-weight': 'bold', 'border-styles': { all: { color: '#000000', style: 'solid' } } }) as any;
        const cell = JSON.parse(result.requests[0].body.input).cells[0][0];
        expect(cell).toEqual({ cell_styles: { font_weight: 'bold' }, border_styles: { top: { color: '#000000', style: 'solid' }, bottom: { color: '#000000', style: 'solid' }, left: { color: '#000000', style: 'solid' }, right: { color: '#000000', style: 'solid' } } });
        await expect(get('cells-set-style').preview({ token: 'a', range: 'A1' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('batches style and clear while retaining each sheet target', async () => {
        const style = await get('cells-batch-set-style').preview({ token: 'a', ranges: ['Data!A1'], 'font-size': 12 }) as any;
        expect(JSON.parse(style.requests[0].body.input).operations[0].input).toMatchObject({ sheet_name: 'Data', cells: [[{ cell_styles: { font_size: 12 } }]] });
        const clear = await get('cells-batch-clear').preview({ token: 'a', ranges: ['Data!A1'], scope: 'all' }) as any;
        expect(JSON.parse(clear.requests[0].body.input).operations[0]).toMatchObject({ tool_name: 'clear_cell_range', input: { sheet_name: 'Data', range: 'A1', clear_type: 'all' } });
    });
});

describe('Sheets CSV paste', () => {
    it('uses range top-left and reports quoted multi-line footprint', async () => {
        const request = vi.fn().mockResolvedValue({ output: '{"revision":1}' });
        const result = await get('csv-put').execute({ token: 'a', 'sheet-id': 's', range: 'B2:Z50', csv: '"a\nb",c\n1,2', 'allow-overwrite': false }, context(request));
        expect(result).toMatchObject({ writes_range: 'B2:C3' });
        expect(JSON.parse(request.mock.calls[0]![0].body.input)).toMatchObject({ start_cell: 'B2', allow_overwrite: false });
    });
    it('rejects conflicting anchors and path-shaped inline content', async () => {
        await expect(get('csv-put').preview({ token: 'a', range: 'A1', 'start-cell': 'B1', csv: 'x,y' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(get('csv-put').preview({ token: 'a', range: 'A1', csv: '/tmp/file.csv' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

describe('Sheets batch shortcut translation', () => {
    it('uses the standalone transformation and top-level workbook', async () => {
        const result = await get('batch-update').preview({ token: 'a', operations: [{ shortcut: '+range-copy', input: { sheet_id: 's', source_range: 'A1', target_range: 'B1', paste_type: 'values', excel_id: 'ignored' } }] }) as any;
        expect(JSON.parse(result.requests[0].body.input)).toEqual({ excel_id: 'a', operations: [{ tool_name: 'transform_range', input: { excel_id: 'a', sheet_id: 's', operation: 'copy', range: 'A1', destination_range: 'B1', paste_type: 'value_only' } }] });
    });
    it('validates all operations before fail-fast and retains local partial failures', async () => {
        const request = vi.fn().mockResolvedValue({ output: '{"results":[{"index":0,"success":true}],"success_count":1}' });
        const operations = [{ shortcut: '+cells-clear', input: { sheet_id: 's' } }, { shortcut: '+sheet-hide', input: { sheet_id: 's' } }];
        await expect(get('batch-update').execute({ token: 'a', operations }, context(request))).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(request).not.toHaveBeenCalled();
        const output = await get('batch-update').execute({ token: 'a', operations, 'continue-on-error': true }, context(request)) as any;
        expect(output.results).toEqual(expect.arrayContaining([expect.objectContaining({ index: 0, success: false, stage: 'cli_validation' }), expect.objectContaining({ index: 1, success: true })]));
        expect(request).toHaveBeenCalledTimes(1);
    });
});

describe('Sheets retry and locator boundaries', () => {
    it('requires URLs for url flags while raw token flags remain literal', async () => {
        await expect(get('workbook-info').preview({ url: 'raw-token' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        const result = await get('workbook-info').preview({ token: 'https://example.com/wiki/literal' }) as any;
        expect(JSON.parse(result.requests[0].body.input).excel_id).toBe('https://example.com/wiki/literal');
    });
    it('retries transient read calls but never rate limits or writes', async () => {
        vi.useFakeTimers();
        try {
            const { ServiceError } = await import('../src/domain/errors');
            const request = vi.fn().mockRejectedValueOnce(new ServiceError('UPSTREAM_HTTP_ERROR', 'Unavailable', 502, { upstreamStatus: 503 })).mockResolvedValue({ output: '{}' });
            const pending = expect(get('workbook-info').execute({ token: 'a' }, context(request))).resolves.toEqual({});
            await vi.runAllTimersAsync();
            await pending;
            expect(request).toHaveBeenCalledTimes(2);
            const limited = vi.fn().mockRejectedValue(new ServiceError('UPSTREAM_HTTP_ERROR', 'Limited', 502, { upstreamStatus: 429 }));
            await expect(get('workbook-info').execute({ token: 'a' }, context(limited))).rejects.toMatchObject({ code: 'UPSTREAM_HTTP_ERROR' });
            expect(limited).toHaveBeenCalledTimes(1);
            await expect(get('sheet-hide').execute({ token: 'a', 'sheet-id': 's' }, context(limited))).rejects.toBeDefined();
            expect(limited).toHaveBeenCalledTimes(2);
        } finally { vi.useRealTimers(); }
    });
});

describe('Sheets sizing', () => {
    it('expands singleton dimensions and rejects column auto sizing', async () => {
        const result = await get('rows-resize').preview({ token: 'a', 'sheet-id': 's', range: '5', height: 24 }) as any;
        expect(JSON.parse(result.requests[0].body.input)).toMatchObject({ range: '5:5', resize_height: { type: 'pixel', value: 24 } });
        await expect(get('cols-resize').preview({ token: 'a', 'sheet-id': 's', range: 'A:C', type: 'auto' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('batches sorted nonoverlapping map sizes', async () => {
        const result = await get('cols-resize').preview({ token: 'a', 'sheet-id': 's', widths: { D: 100, 'A:B': 'standard' } }) as any;
        expect(result.requests[0].body.tool_name).toBe('batch_update');
        expect(JSON.parse(result.requests[0].body.input).operations.map((op: any) => op.input.range)).toEqual(['A:B', 'D:D']);
        await expect(get('cols-resize').preview({ token: 'a', 'sheet-id': 's', widths: { 'A:B': 100, 'B:C': 120 } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

describe('Sheets formula verification', () => {
    it('retains plural selection and AI-only semantics without polling', async () => {
        const request = vi.fn().mockResolvedValue({ output: '{"status":"partial","ai_formula_pending_count":3}' });
        await get('formula-verify').execute({ token: 'a', 'sheet-name': ['A', 'B'], range: ['A1:B5'], 'ai-only': true }, context(request));
        expect(JSON.parse(request.mock.calls[0]![0].body.input)).toEqual({ excel_id: 'a', sheet_names: ['A', 'B'], ranges: ['A1:B5'], ai_only: true });
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('returns a typed error carrying the failed report when requested', async () => {
        const request = vi.fn().mockResolvedValue({ output: '{"status":"errors_found","total_errors":2}' });
        await expect(get('formula-verify').execute({ token: 'a', 'exit-on-error': true }, context(request))).rejects.toMatchObject({ code: 'FORMULA_ERRORS_FOUND', details: { report: { status: 'errors_found', total_errors: 2 } } });
    });
});
it('declares workbook conversion and creation permission scopes explicitly', () => {
    const definitions = sheetsCapabilities().map(capability => capability.definition);
    expect(definitions.find(d => d.id === 'sheets.+workbook-create')!.scopes).toContain('sheets:spreadsheet:create');
    expect(definitions.find(d => d.id === 'sheets.+workbook-import')!.scopes).toContain('docs:document:import');
    expect(definitions.find(d => d.id === 'sheets.+workbook-export')!.scopes).toContain('docs:document:export');
});

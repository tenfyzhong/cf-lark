import { it, expect, vi } from 'vitest';
import { sheetsPrograms } from '../src/capabilities/sheets/programs';
import { sheetsCapabilities } from '../src/capabilities/sheets/commands';
import type { CommandContext } from '../src/ports/capabilities';
it('validates typed cells before creating a workbook', async () => {
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+workbook-create')!;
    const request = vi.fn();
    await expect(capability.execute({ title: 'Bad', sheets: { sheets: [{ name: 'Data', columns: ['N'], dtypes: { N: 'float64' }, data: [['wrong']] }] } }, { lark: { request } } as unknown as CommandContext)).rejects.toThrow('numeric');
    expect(request).not.toHaveBeenCalled();
});
it('writes typed dates and numbers with text formats retained', async () => {
    const program = sheetsPrograms().find(p => p.id === 'sheets-table-put')!;
    const request = vi.fn().mockResolvedValue({ output: '{}' });
    const result = await program.step({ token: 'b', args: { sheets: { sheets: [{ name: 'Data', columns: ['ID', 'N', 'Date'], dtypes: { N: 'float64', Date: 'date' }, data: [['001', '2.5', '1970-01-01']] }] } }, targets: [{ sheet_id: 's', sheet_name: 'Data', row_count: 200, column_count: 20 }], phase: 'write' }, { lark: { request } } as unknown as CommandContext);
    const value = JSON.parse(request.mock.calls[0]![0].body.input);
    expect(value.range).toBe('A1:C2');
    expect(value.cells[1]).toEqual([{ value: '001', cell_styles: { number_format: '@' } }, { value: 2.5 }, { value: 25569, cell_styles: { number_format: 'yyyy-mm-dd' } }]);
    expect(result).toMatchObject({ done: true, output: { spreadsheet_token: 'b', sheets: [{ name: 'Data', writes: 1 }] } });
});
it('uses the full physical grid to place appended rows and preserves the start column', async () => {
    const program = sheetsPrograms().find(p => p.id === 'sheets-table-put')!;
    const request = vi.fn().mockResolvedValueOnce({ output: '{"current_region":"A1:F100"}' }).mockResolvedValue({ output: '{}' });
    const context = { lark: { request } } as unknown as CommandContext;
    const state = { token: 'b', args: { sheets: [{ name: 'Data', columns: ['X'], data: [['tail']], mode: 'append', start_cell: 'C2' }] }, targets: [{ sheet_id: 's', sheet_name: 'Data', row_count: 200, column_count: 20 }], phase: 'write' };
    const probe = await program.step(state, context);
    expect(JSON.parse(request.mock.calls[0]![0].body.input).range).toBe('A1:T200');
    if (probe.done) throw Error('Expected append checkpoint');
    await program.step(probe.state, context);
    expect(JSON.parse(request.mock.calls[1]![0].body.input).range).toBe('C101:C101');
});
it('merges cell styles into padded typed matrices without replacing number formats', async () => {
    const program = sheetsPrograms().find(p => p.id === 'sheets-table-put')!;
    const request = vi.fn().mockResolvedValue({ output: '{}' });
    const args = { sheets: [{ name: 'Data', columns: ['ID'], data: [['001']], start_cell: 'B2' }], styles: [{ name: 'Data', cell_styles: [{ range: 'B3:D4', font_weight: 'bold' }] }] };
    const result = await program.step({ token: 'b', args, targets: [{ sheet_id: 's', sheet_name: 'Data' }], phase: 'write' }, { lark: { request } } as unknown as CommandContext);
    const input = JSON.parse(request.mock.calls[0]![0].body.input);
    expect(input.range).toBe('B2:D4');
    expect(input.cells[1][0]).toEqual({ value: '001', cell_styles: { number_format: '@', font_weight: 'bold' } });
    expect(input.cells[2][2]).toEqual({ cell_styles: { font_weight: 'bold' } });
    expect(result).toMatchObject({ done: true });
});
it.each(['overwrite', 'append'])('rejects styles above a new workbook anchor before creating in %s mode', async mode => {
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+workbook-create')!;
    await expect(capability.preview({ title: 'Bad', sheets: [{ name: 'Data', columns: ['X'], data: [['x']], start_cell: 'B2', mode }], styles: [{ name: 'Data', cell_styles: [{ range: 'A1', font_weight: 'bold' }] }] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('requires typed style items to match every sheet in payload order', async () => {
    const { tableWriteInput } = await import('../src/capabilities/sheets/table-write-input');
    expect(() => tableWriteInput({ sheets: [{ name: 'A', columns: ['X'] }, { name: 'B', columns: ['Y'] }], styles: [{ name: 'B', freeze: { rows: 1 } }] })).toThrow();
});
it('normalizes column aliases and rejects ambiguous positional dtype labels', async () => {
    const { tableWriteInput, tableMatrix } = await import('../src/capabilities/sheets/table-write-input');
    const sheets = tableWriteInput({ sheets: [{ name: 'Data', columns: [{ title: 'Price', dtype: 'number' }], data: [['2.5']] }] });
    expect(tableMatrix(sheets[0]!, true)[1]).toEqual([{ value: 2.5 }]);
    expect(() => tableWriteInput({ sheets: [{ name: 'D', columns: ['A', 'B'], dtypes: ['number'], data: [] }] })).toThrow();
    expect(() => tableWriteInput({ sheets: [{ name: 'D', columns: ['A', 'A'], dtypes: ['number', 'string'], data: [] }] })).toThrow();
});
it('infers headerless untyped rows and avoids auto-name collisions', async () => {
    const { tableWriteInput, tableMatrix } = await import('../src/capabilities/sheets/table-write-input');
    const inferred = tableWriteInput({ sheets: [{ name: 'D', data: [[12, true], [null]] }] })[0]!;
    expect(inferred.header).toBe(false);
    expect(tableMatrix(inferred, false)[0]).toEqual([{ value: 12 }, { value: true }]);
    expect(tableWriteInput({ title: 'New', sheets: [{ columns: [] }, { name: 'Sheet1', columns: [] }] }, true).map(s => s.name)).toEqual(['Sheet2', 'Sheet1']);
});
it('creates and fills a style-only workbook with an unnamed values style item', async () => {
    const program = sheetsPrograms().find(p => p.id === 'sheets-workbook-create')!;
    const request = vi.fn().mockResolvedValueOnce({ spreadsheet: { spreadsheet_token: 'b' } }).mockResolvedValueOnce({ output: '{"sheets":[{"sheet_id":"s","sheet_name":"Sheet1"}]}' }).mockResolvedValue({ output: '{}' });
    let state: Record<string, unknown> = { args: { title: 'Styles', styles: [{ cell_styles: [{ range: 'B3', font_weight: 'bold' }] }] } };
    for (let i = 0; i < 10; i++) { const result = await program.step(state, { lark: { request } } as unknown as CommandContext); if (result.done) break; state = result.state; }
    const writes = request.mock.calls.map(c => c[0].body).filter(b => b.tool_name === 'set_cell_range');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0].input)).toMatchObject({ range: 'A1:B3', cells: [[{}, {}], [{}, {}], [{}, { cell_styles: { font_weight: 'bold' } }]] });
});
it('finishes each sheet visual operations before writing the next sheet', async () => {
    const program = sheetsPrograms().find(p => p.id === 'sheets-table-put')!;
    const request = vi.fn().mockResolvedValue({ output: '{}' });
    let state: Record<string, unknown> = { token: 'b', args: { sheets: [{ name: 'A', columns: ['X'], data: [['a']] }, { name: 'B', columns: ['X'], data: [['b']] }], styles: [{ name: 'A', freeze: { rows: 1 } }, { name: 'B', freeze: { rows: 1 } }] }, targets: [{ sheet_id: 'a', sheet_name: 'A' }, { sheet_id: 'b', sheet_name: 'B' }] };
    for (let i = 0; i < 10; i++) { const result = await program.step(state, { lark: { request } } as unknown as CommandContext); if (result.done) break; state = result.state; }
    expect(request.mock.calls.map(c => c[0].body.tool_name)).toEqual(['set_cell_range', 'batch_update', 'set_cell_range', 'batch_update']);
});
it('sizes missing sheets from visual extents and rejects unbounded style stamps', async () => {
    const program = sheetsPrograms().find(p => p.id === 'sheets-table-put')!;
    const request = vi.fn().mockResolvedValue({ output: '{}' });
    await program.step({ token: 'b', args: { sheets: [{ name: 'A', columns: ['X'] }], styles: [{ name: 'A', cell_styles: [{ range: 'AA301', font_weight: 'bold' }] }] }, targets: [] }, { lark: { request } } as unknown as CommandContext);
    expect(JSON.parse(request.mock.calls[0]![0].body.input)).toMatchObject({ rows: 301, columns: 27 });
    const { tableWriteInput } = await import('../src/capabilities/sheets/table-write-input');
    expect(() => tableWriteInput({ sheets: [{ name: 'A', columns: ['X'] }], styles: [{ name: 'A', cell_styles: [{ range: 'A:A', font_weight: 'bold' }] }] })).toThrow();
});
it('reports confirmed partial failures with completed sheet evidence without swallowing uncertain writes', async () => {
    const { ServiceError } = await import('../src/domain/errors');
    const program = sheetsPrograms().find(p => p.id === 'sheets-table-put')!;
    const state = { token: 'b', args: { sheets: [{ name: 'B', columns: ['X'], data: [['b']] }] }, written: [{ name: 'A', sheet_id: 'a' }], targets: [{ sheet_id: 'b', sheet_name: 'B' }] };
    const request = vi.fn().mockRejectedValue(new ServiceError('LARK_API_ERROR', 'Denied', 502, { upstreamCode: 999 }));
    expect(await program.step(state, { lark: { request } } as unknown as CommandContext)).toMatchObject({ done: true, output: { ok: false, spreadsheet_token: 'b', written_sheets: [{ name: 'A' }], cause: { code: 'LARK_API_ERROR', details: { upstreamCode: 999 } } } });
    request.mockRejectedValue(new ServiceError('OUTCOME_UNCERTAIN', 'Unknown', 502));
    await expect(program.step(state, { lark: { request } } as unknown as CommandContext)).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
});
it('reports a created workbook token when its initial discovery fails', async () => {
    const { ServiceError } = await import('../src/domain/errors');
    const program = sheetsPrograms().find(p => p.id === 'sheets-workbook-create')!;
    const request = vi.fn().mockRejectedValue(new ServiceError('LARK_API_ERROR', 'Denied', 502));
    expect(await program.step({ token: 'new', spreadsheet: { spreadsheet_token: 'new' }, args: { title: 'Created', sheets: [{ name: 'A', columns: ['X'] }] } }, { lark: { request } } as unknown as CommandContext)).toMatchObject({ done: true, output: { ok: false, spreadsheet_token: 'new' } });
});
it('preserves numeric lexemes in typed, numeric-string and untyped JSON inputs', async () => {
    const program = sheetsPrograms().find(p => p.id === 'sheets-table-put')!;
    const request = vi.fn().mockResolvedValue({ output: '{}' });
    await program.step({ token: 'b', args: { sheets: '[{"name":"A","columns":["N","S","T"],"dtypes":{"N":"number","S":"number"},"data":[[9007199254740993,"1.234567890123456789",9007199254740993]]}]' }, targets: [{ sheet_id: 'a', sheet_name: 'A' }] }, { lark: { request } } as unknown as CommandContext);
    const input = request.mock.calls[0]![0].body.input;
    expect(input).toContain('"value":9007199254740993');
    expect(input).toContain('"value":1.234567890123456789');
    expect(input).toContain('"value":"9007199254740993"');
    const create = sheetsPrograms().find(p => p.id === 'sheets-workbook-create')!;
    await create.step({ token: 'b', args: { title: 'Values', values: '[[9007199254740993, 1.234567890123456789]]' }, targets: [{ sheet_id: 'a', sheet_name: 'Sheet1' }], adopted: true }, { lark: { request } } as unknown as CommandContext);
    expect(request.mock.calls[1]![0].body.input).toContain('"value":9007199254740993');
    expect(request.mock.calls[1]![0].body.input).toContain('"value":1.234567890123456789');
});
it('does not rename the default sheet when the first payload target already exists', async () => {
    const program = sheetsPrograms().find(p => p.id === 'sheets-workbook-create')!;
    const request = vi.fn().mockResolvedValue({ output: '{}' });
    const result = await program.step({ token: 'b', args: { title: 'New', sheets: [{ name: 'Existing', columns: ['X'] }] }, targets: [{ sheet_id: 'default', sheet_name: 'Sheet1' }, { sheet_id: 'target', sheet_name: 'Existing' }], phase: 'adopt' }, { lark: { request } } as unknown as CommandContext);
    expect(request).not.toHaveBeenCalled();
    expect(result).toMatchObject({ done: false, state: { adopted: true, targets: [{ sheet_id: 'default', sheet_name: 'Sheet1' }, { sheet_id: 'target', sheet_name: 'Existing' }] } });
});
it('rejects conflicting item border spellings', async () => {
    const { tableWriteInput } = await import('../src/capabilities/sheets/table-write-input');
    expect(() => tableWriteInput({ sheets: [{ name: 'A', columns: ['X'] }], styles: [{ name: 'A', border_styles: { top: { color: '#000000' } }, cell_styles: [{ range: 'A1', border: 'all' }] }] })).toThrow();
});
it('preserves ISO wall-clock timestamps in date-typed cells', async () => {
    const { typedCell } = await import('../src/capabilities/sheets/table-write-input');
    expect(typedCell('1970-01-01T12:30:00+08:00', 'date', '').value).toBeCloseTo(25569 + 12.5 / 24, 10);
    expect(typedCell('1970-01-01T00:00:00.123456789', 'date', '').value).toBeCloseTo(25569 + 0.123456789 / 86400, 10);
    for (const input of ['1970-01-01T25:00:00', '2025-02-30T01:00:00', '1970-01-01T12:00']) expect(() => typedCell(input, 'date', '')).toThrow();
});
it('applies values-mode axis-only styles without an empty cell write or default-sheet rename', async () => {
    const program = sheetsPrograms().find(p => p.id === 'sheets-workbook-create')!;
    const request = vi.fn().mockResolvedValue({ output: '{}' });
    const args = { title: 'Book', styles: [{ row_sizes: [{ range: '1:3', size: 30 }] }] };
    let state: any = { token: 'b', spreadsheet: { spreadsheet_token: 'b' }, args, targets: [{ sheet_id: 's', sheet_name: 'Default' }], phase: 'write' };
    let result: any;
    for (let n = 0; n < 4; n++) { result = await program.step(state, { lark: { request } } as unknown as CommandContext); if (result.done) break; state = result.state; }
    expect(result).toEqual({ done: true, output: { spreadsheet: { spreadsheet_token: 'b' } } });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0].body.tool_name).toBe('batch_update');
    expect(JSON.parse(request.mock.calls[0]![0].body.input).operations[0].input).toMatchObject({ sheet_id: 's', range: '1:3' });
});

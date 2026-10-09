import { expect, it, vi } from 'vitest';
import { sheetsPrograms } from '../src/capabilities/sheets/programs';
import type { CommandContext } from '../src/ports/capabilities';
function setup(outputs: unknown[]) {
    const request = vi.fn();
    outputs.forEach(output => request.mockResolvedValueOnce({ output: JSON.stringify(output) }));
    const context = { lark: { request } } as unknown as CommandContext;
    const program = sheetsPrograms().find(p => p.id === 'sheets-table-get')!;
    return { request, context, program };
}
it('reads explicit table ranges without discovery and infers lossless typed columns', async () => {
    const { request, context, program } = setup([{ ranges: [{ cells: [
        [{ value: 'Mixed' }, { value: 'Date' }, { value: 'Flag' }],
        [{ value: 2 }, { value: 25569, cell_styles: { number_format: 'yyyy-mm-dd' } }, { value: true }],
        [{ value: 'N/A' }, { value: 25570, cell_styles: { number_format: 'yyyy-mm-dd' } }],
    ] }] }]);
    const result = await program.step({ token: 'book', args: { 'sheet-name': 'Data', range: 'A1:C3' } }, context);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0]![0].body.input)).toMatchObject({ ranges: ['A1:C3'], include_styles: true, value_render_option: 'raw_value' });
    expect(result).toMatchObject({ done: true, output: { sheets: [{ name: 'Data', columns: ['Mixed', 'Date', 'Flag'], dtypes: { Mixed: 'object', Date: 'datetime64[ns]', Flag: 'bool' }, data: [['2', '1970-01-01', true], ['N/A', '1970-01-02', null]] }] } });
});
it('discovers and probes the physical grid across internal empty gaps', async () => {
    const { request, context, program } = setup([{ sheets: [{ sheet_id: 's', sheet_name: 'Data', row_count: 120, column_count: 30 }] }, { current_region: 'A1:C110' }, { ranges: [{ cells: [[{ value: 'Name' }], [{ value: 'end' }]], truncated: true }] }]);
    let state: any = { token: 'book', args: {} };
    let result: any = await program.step(state, context);
    expect(result.done).toBe(false);
    result = await program.step(result.state, context);
    expect(JSON.parse(request.mock.calls[1]![0].body.input).range).toBe('A1:AD120');
    result = await program.step(result.state, context);
    expect(result.output.sheets[0]).toMatchObject({ range: 'A1:C110', truncated: true });
    expect(request).toHaveBeenCalledTimes(3);
});
it('rejects duplicate headers and truncated region probes', async () => {
    const a = setup([{ ranges: [{ cells: [[{ value: 'x' }, { value: 'x' }]] }] }]);
    await expect(a.program.step({ token: 'b', args: { range: 'A1:B1', 'sheet-id': 's' } }, a.context)).rejects.toThrow('duplicate');
    const b = setup([{ current_region: 'A1', truncated: true }]);
    await expect(b.program.step({ token: 'b', args: {}, targets: [{ sheet_id: 's', sheet_name: 'Data' }], offset: 0 }, b.context)).rejects.toThrow('truncated');
});
it('classifies date formats using effective tokens rather than quoted or bracketed literals', async () => {
    const { context, program } = setup([{ ranges: [{ cells: [
        [{ value: 'Literal' }, { value: 'Bracket' }, { value: 'Calendar' }, { value: 'Clock' }],
        [{ value: 25569, cell_styles: { number_format: '"yy' } }, { value: 25569, cell_styles: { number_format: '[yy' } }, { value: 25569, cell_styles: { number_format: 'm/d' } }, { value: 0.5, cell_styles: { number_format: 'hh:mm:ss AM/PM' } }],
    ] }] }]);
    const result: any = await program.step({ token: 'b', args: { 'sheet-name': 'Data', range: 'A1:D2' } }, context);
    expect(result.output.sheets[0].dtypes).toEqual({ Literal: 'float64', Bracket: 'float64', Calendar: 'datetime64[ns]', Clock: 'float64' });
});

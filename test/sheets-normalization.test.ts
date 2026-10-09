import { expect, it } from 'vitest';
import { parseSheetJSON } from '../src/capabilities/sheets/json';
import { normalizeCellStyle, normalizeBorders } from '../src/capabilities/sheets/normalize';
it('repairs only unambiguous alternative JSON spellings', () => {
    expect(parseSheetJSON("[{value:'x',flag:True,none:None,}]")).toEqual([{ value: 'x', flag: true, none: null }]);
    expect(parseSheetJSON("[['it\\'s','line\\nfeed']]")).toEqual([["it's", 'line\nfeed']]);
    expect(parseSheetJSON('[[unquoted words]]')).toEqual([['unquoted words']]);
    for (const input of ['[["a"]}', '[["a"]', '[[123text]]', "[['bad\\x20escape']]"]) expect(() => parseSheetJSON(input)).toThrow();
});
it('normalizes style names and values but rejects conflicting aliases', () => {
    expect(normalizeCellStyle({ font_name: 'Arial', bold: true, italic: false, wrap_text: true, font_size: '16', halign: 'CENTER' })).toEqual({ font_family: 'Arial', font_weight: 'bold', font_style: 'normal', word_wrap: 'auto-wrap', font_size: 16, horizontal_alignment: 'center' });
    expect(() => normalizeCellStyle({ halign: 'left', horizontal_alignment: 'right' })).toThrow('conflict');
    expect(() => normalizeCellStyle({ fore_color: '#FFFFFF' })).toThrow('ambiguous');
});
it('expands border aliases with explicit side precedence and separates weight from line type', () => {
    expect(normalizeBorders({ outer: { type: 'thin', color: '#000000' }, top: { style: 'solid', width: 2 } })).toMatchObject({ top: { style: 'solid', weight: 'medium' }, bottom: { style: 'solid', weight: 'thin', color: '#000000' } });
});
it('uses JSON repair and typed-style normalization through cell command previews', async () => {
    const { sheetsCapabilities } = await import('../src/capabilities/sheets/commands');
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+cells-set')!;
    const result: any = await capability.preview({ token: 'b', 'sheet-id': 's', range: 'A1', cells: "[[{value:'x',style:{bold:True,wrap:True},}]]" });
    expect(JSON.parse(result.requests[0].body.input).cells).toEqual([[{ value: 'x', cell_styles: { font_weight: 'bold', word_wrap: 'auto-wrap' } }]]);
});
it('accepts cell envelopes and pads ragged rows with no-op cell objects', async () => {
    const { sheetsCapabilities } = await import('../src/capabilities/sheets/commands');
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+cells-set')!;
    const result: any = await capability.preview({ token: 'b', range: 'A1', cells: { cells: [[{ value: 'x', font_weight: 'bold' }, 1], [2]] } });
    expect(JSON.parse(result.requests[0].body.input).cells).toEqual([[{ value: 'x', cell_styles: { font_weight: 'bold' } }, { value: 1 }], [{ value: 2 }, {}]]);
});

it('accepts a single scattered write envelope and values alias', async () => {
    const { sheetsCapabilities } = await import('../src/capabilities/sheets/commands');
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+cells-set')!;
    const result: any = await capability.preview({ token: 'b', writes: { writes: { sheet_id: 's', range: 'A1', values: 7 } } });
    expect(JSON.parse(result.requests[0].body.input).operations[0].input.cells).toEqual([[{ value: 7 }]]);
});
it('compacts batch create snapshots without dropping identifiers or unrelated data', async () => {
    const { compactBatchOutput } = await import('../src/capabilities/sheets/batch');
    const original = { results: [{ data: { snapshot: { large: true }, chart_id: 'c' } }, { data: { value: 1 } }] };
    expect(compactBatchOutput(original)).toEqual({ results: [{ data: { chart_id: 'c' } }, { data: { value: 1 } }] });
    expect(original.results[0]!.data.snapshot).toEqual({ large: true });
});
it('rejects typed cells with invalid content values', async () => {
    const { sheetsCapabilities } = await import('../src/capabilities/sheets/commands');
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+cells-set')!;
    for (const cell of [{ value: { nested: 1 } }, { value: null }, { formula: 4 }]) await expect(capability.preview({ token: 'b', range: 'A1', cells: [[cell]] })).rejects.toThrow();
});
it('accepts JSON numeric style strings but rejects non-JSON numeric spellings', () => {
    expect(normalizeCellStyle({ font_size: ' 1.6e1 ' })).toEqual({ font_size: 16 });
    for (const font_size of ['0x10', '+16', '.5', '01', 'Infinity', 'null']) expect(() => normalizeCellStyle({ font_size })).toThrow();
});
it('rejects a missing cells payload before it becomes an empty no-op cell', async () => {
    const { sheetsCapabilities } = await import('../src/capabilities/sheets/commands');
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+cells-set')!;
    await expect(capability.preview({ token: 'b', range: 'A1' })).rejects.toThrow('cells');
});
it('coalesces identical flag aliases without shadowing conflicting values', async () => {
    const { normalizeSheetFlags } = await import('../src/capabilities/sheets/flag-normalization');
    expect(normalizeSheetFlags('cells-set', { 'sheet-id': 's', sheet_id: 's', cells: [[1]] })).toEqual({ 'sheet-id': 's', cells: [[1]] });
    expect(() => normalizeSheetFlags('cells-set', { 'sheet-id': 's', sheet_id: 'other' })).toThrow('conflicts');
});

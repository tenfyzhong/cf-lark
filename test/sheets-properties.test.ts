import { expect, it } from 'vitest';
import { normalizeConditionalFormat, normalizeChartColors } from '../src/capabilities/sheets/property-normalization';
it('normalizes conditional comparison shapes and style vocabulary', () => {
    expect(normalizeConditionalFormat({ attrs: { operator: '>=', value: 100 }, style: { background_color: '#FFFFFF', font: ['italic'], bold: true, font_line: 'line-through' } })).toEqual({ attrs: [{ compare_type: 'greaterThanOrEqual', value: '100' }], style: { back_color: '#FFFFFF', font: 'bold italic', text_decoration: 'strikethrough' } });
    expect(normalizeConditionalFormat({ attrs: { criteria: 'NOT_BETWEEN', value: [1, 4] } })).toEqual({ attrs: [{ compare_type: 'notBetween', value: '1,4' }] });
});
it('preserves shape-specific operators and ambiguous font forms for rejection', () => {
    expect(normalizeConditionalFormat({ attrs: { operator: '>', value_type: 'number', value: 2 }, style: { font: { bold: true, underline: true }, italic: true } })).toEqual({ attrs: [{ operator: '>', value_type: 'number', value: 2 }], style: { font: { bold: true, underline: true }, italic: true } });
});
it('normalizes nested color arrays without changing text or malformed color values', () => {
    expect(normalizeChartColors({ title: 'FFFFFF', colorTheme: ['4472C4', ['FF000080']], plot: { fontColor: 'aabbcc', colors: ['red', '12345'] } })).toEqual({ title: 'FFFFFF', colorTheme: ['#4472C4', ['#FF000080']], plot: { fontColor: '#aabbcc', colors: ['red', '12345'] } });
});
it('canonicalizes flat flag enums and clears the retired inheritance value', async () => {
    const { sheetsCapabilities } = await import('../src/capabilities/sheets/commands');
    const merge = sheetsCapabilities().find(c => c.definition.id === 'sheets.+cells-merge')!;
    const result: any = await merge.preview({ token: 'b', range: 'A1:B2', 'merge-type': 'MERGE_ALL' });
    expect(JSON.parse(result.requests[0].body.input).merge_type).toBe('all');
    const insert = sheetsCapabilities().find(c => c.definition.id === 'sheets.+dim-insert')!;
    const inherited: any = await insert.preview({ token: 'b', position: 'A', count: 1, 'inherit-style': 'NONE' });
    expect(JSON.parse(inherited.requests[0].body.input).inherit_style).toBeUndefined();
    await expect(merge.preview({ token: 'b', range: 'A1:B2', 'merge-type': 'almost' })).rejects.toThrow();
});
it('normalizes schema-derived property enums at nested array paths', async () => {
    const { normalizePropertyEnums } = await import('../src/capabilities/sheets/property-normalization');
    expect(normalizePropertyEnums('pivot-create', { values: [{ field: 'Sales', summarize_by: 'SUM' }] })).toEqual({ values: [{ field: 'Sales', summarize_by: 'sum' }] });
});
it('normalizes command aliases and spelling variants while rejecting unknown flags and conflicts', async () => {
    const { sheetsCapabilities } = await import('../src/capabilities/sheets/commands');
    const rename = sheetsCapabilities().find(c => c.definition.id === 'sheets.+sheet-rename')!;
    const result: any = await rename.preview({ token: 'b', SheetName: 'Old', new_name: 'New' });
    expect(JSON.parse(result.requests[0].body.input)).toMatchObject({ sheet_name: 'Old', new_name: 'New' });
    await expect(rename.preview({ token: 'b', 'sheet-id': 's', title: 'A', name: 'B' })).rejects.toThrow();
    await expect(rename.preview({ token: 'b', 'sheet-id': 's', title: 'A', typo: 1 })).rejects.toThrow();
});
it('advertises the accepted cell and batch envelope shapes at the MCP boundary', async () => {
    const { default: Ajv } = await import('ajv');
    const { sheetsDefinitions } = await import('../src/capabilities/sheets/definitions');
    const ajv = new Ajv({ strict: false });
    for (const [name, args] of [['cells-set', { cells: { cells: [[1]] } }], ['cells-set', { cells: 1 }], ['cells-set', { writes: { writes: { range: 'A1', cells: 1 } } }], ['batch-update', { operations: { operations: [{ shortcut: '+sheet-create', input: { title: 'A' } }] } }], ['cells-set-style', { 'border-styles': 2 }]] as const) {
        const definition = sheetsDefinitions.find(d => d.id === `sheets.+${name}`)!;
        expect(ajv.compile(definition.inputSchema)(args), name).toBe(true);
    }
});
it('accepts only the pinned unambiguous bare-list flags', async () => {
    const { normalizeSheetFlags } = await import('../src/capabilities/sheets/flag-normalization');
    expect(normalizeSheetFlags('cond-format-create', { range: "'Q1,Sales'!A1:B2,Other!C1" }).ranges).toEqual(["'Q1,Sales'!A1:B2", 'Other!C1']);
    expect(normalizeSheetFlags('dropdown-set', { options: 'Ready' }).options).toEqual(['Ready']);
    expect(normalizeSheetFlags('dropdown-set', { options: 'Ready, Waiting' }).options).toBe('Ready, Waiting');
});
it('checks detached chart header orientation and dimension count before invocation', async () => {
    const { sheetsCapabilities } = await import('../src/capabilities/sheets/commands');
    const create = sheetsCapabilities().find(c => c.definition.id === 'sheets.+chart-create-basic')!;
    await expect(create.preview({ token: 'b', 'chart-type': 'column', 'data-range': 'A1:C4', 'header-range': 'F1:F3' })).rejects.toThrow('header');
    await expect(create.preview({ token: 'b', 'chart-type': 'column', 'data-range': 'A1:C4', 'header-range': 'F1:G1' })).rejects.toThrow('header');
    const result: any = await create.preview({ token: 'b', 'chart-type': 'column', 'data-range': 'A1:C4', 'header-range': 'F1:H1' });
    expect(JSON.parse(result.requests[0].body.input).basic_chart.header_range).toBe('F1:H1');
});
it('normalizes and validates batch flags before selector inference and rejects unsupported wrappers', async () => {
    const { sheetsCapabilities } = await import('../src/capabilities/sheets/commands');
    const batch = sheetsCapabilities().find(c => c.definition.id === 'sheets.+batch-update')!;
    const result: any = await batch.preview({ token: 'b', operations: [{ shortcut: '+sheet-rename', input: { sheet: 'Old', name: 'New' } }] });
    expect(JSON.parse(result.requests[0].body.input).operations[0].input).toMatchObject({ sheet_name: 'Old', new_name: 'New' });
    for (const operation of [{ shortcut: '+sheet-rename', input: { sheet: 'Old', name: 'New' }, extra: true }, { shortcut: '+history-revert', input: { 'history-version-id': '1' } }, { shortcut: '+sheet-rename', input: { sheet_name: 'A', 'sheet-name': 'B', title: 'C' } }]) await expect(batch.preview({ token: 'b', operations: [operation] })).rejects.toThrow();
});
it('lifts consistent range qualifiers without splitting quoted sheet commas', async () => {
    const { sheetsCapabilities } = await import('../src/capabilities/sheets/commands');
    const cells = sheetsCapabilities().find(c => c.definition.id === 'sheets.+cells-get')!;
    const result: any = await cells.preview({ token: 'b', range: "'Q1,Sales'!A1:B2,'Q1,Sales'!D1,D3" });
    expect(JSON.parse(result.requests[0].body.input)).toMatchObject({ sheet_name: 'Q1,Sales', ranges: ['A1:B2', 'D1', 'D3'] });
    const unicode: any = await cells.preview({ token: 'b', range: "'Sales!Q1'\\\uFF01A1" });
    expect(JSON.parse(unicode.requests[0].body.input)).toMatchObject({ sheet_name: 'Sales!Q1', ranges: ['A1'] });
    const explicit: any = await cells.preview({ token: 'b', 'sheet-id': 's', range: "'Q1,Sales'!A1:B2,D1" });
    expect(JSON.parse(explicit.requests[0].body.input).ranges).toEqual(["'Q1,Sales'!A1:B2", 'D1']);
});

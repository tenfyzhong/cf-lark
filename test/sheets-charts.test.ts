import { it, expect, vi } from 'vitest';
import { sheetsCapabilities } from '../src/capabilities/sheets/commands';
import { sheetsPrograms } from '../src/capabilities/sheets/programs';
import type { CommandContext } from '../src/ports/capabilities';
it('builds a semantic chart and validates selected dimensions', async () => {
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+chart-create-basic')!;
    const result: any = await capability.preview({ token: 'b', 'sheet-name': 'Data', 'chart-type': 'line', 'data-range': 'A1:C4', 'dim2-indexes': '2,3', 'anchor-cell': 'F2', width: 400, height: 300 });
    expect(JSON.parse(result.requests[0].body.input)).toMatchObject({ operation: 'create', basic_chart: { chart_type: 'line', data_range: 'A1:C4', dim2_indexes: [2, 3], position: { row: 2, col: 'F' } } });
    await expect(capability.preview({ token: 'b', 'chart-type': 'pie', 'data-range': 'A1:C4', 'dim2-indexes': '2,3' })).rejects.toThrow('one');
});
it('patches chart configuration from a read snapshot while preserving existing style fields', async () => {
    const program = sheetsPrograms().find(p => p.id === 'sheets-chart-update')!;
    const request = vi.fn().mockResolvedValueOnce({ output: JSON.stringify({ sheets: [{ charts: [{ chart_id: 'c', details: { snapshot: { title: { text: 'Old', fontSize: 12 }, plotArea: { plot: { type: 'line', extra: { marker: true } }, axes: [{ type: 'x', label: { fontSize: 9 } }] }, data: { retained: true } } } }] }] }) }).mockResolvedValue({ output: '{"revision":3}' });
    const context = { lark: { request } } as unknown as CommandContext;
    const first = await program.step({ token: 'b', name: 'chart-config-update', args: { 'chart-id': 'c', title: 'New', smooth: true, 'x-axis-label-angle': 45 }, value: { excel_id: 'b', sheet_id: 's', chart_id: 'c' } }, context);
    expect(first.done).toBe(false); if (first.done) return;
    const second = await program.step(first.state, context);
    const patch = JSON.parse(request.mock.calls[1]![0].body.input).properties.snapshot;
    expect(patch.title).toEqual({ text: 'New', fontSize: 12 });
    expect(patch.plotArea.plot.extra).toEqual({ marker: true, smooth: true });
    expect(patch.data).toBeUndefined();
    expect(second).toMatchObject({ done: true, output: { revision: 3 } });
});
it('rewrites chart data roles without replacing view configuration', async () => {
    const program = sheetsPrograms().find(p => p.id === 'sheets-chart-update')!;
    const request = vi.fn().mockResolvedValue({ output: '{}' });
    await program.step({ token: 'b', name: 'chart-data-update', args: { 'chart-id': 'c', 'data-range': 'A1:C4' }, value: { excel_id: 'b', sheet_id: 's', chart_id: 'c' }, snapshot: { plotArea: { plot: { type: 'line' } }, data: { direction: 'column' } } }, { lark: { request } } as unknown as CommandContext);
    expect(JSON.parse(request.mock.calls[0]![0].body.input).properties.snapshot).toEqual({ data: { isStaticData: false, direction: 'column', refs: [{ value: 'A1:C4' }], dim1: { serie: { index: 1 } }, dim2: { series: [{ index: 2 }, { index: 3 }] } } });
});
it('batch creation keeps local failure indexes and enables partial success by default', async () => {
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+batch-chart-create')!;
    const request = vi.fn().mockResolvedValue({ output: '{"succeeded":1,"failed":0,"results":[{"index":0,"success":true}]}' });
    const output: any = await capability.execute({ token: 'b', operations: [{ sheet_name: 'Data', chart_type: 'line', data_range: 'A1:B5' }, { sheet_name: 'Data', chart_type: 'pie', data_range: 'A1:A1' }] }, { lark: { request } } as unknown as CommandContext);
    expect(JSON.parse(request.mock.calls[0]![0].body.input).continue_on_error).toBe(true);
    expect(output.failed).toBe(1);
    expect(output.results[1]).toMatchObject({ index: 1, stage: 'cli_validation' });
});
it('batch updates reject duplicate chart targets before any reads', async () => {
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+batch-chart-update')!;
    await expect(capability.preview({ token: 'b', operations: [
        { shortcut: '+chart-config-update', input: { sheet_id: 's', chart_id: 'c', title: 'A' } },
        { shortcut: '+chart-config-update', input: { sheet_id: 's', chart_id: 'c', title: 'B' } },
    ] })).rejects.toThrow('duplicate');
});
it('normalizes overlapping ranges but rejects unaligned cross-sheet chart ranges', async () => {
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+chart-create-basic')!;
    const result: any = await capability.preview({ token: 'b', 'chart-type': 'line', 'data-range': "'Sales'!A1:B4,'Sales'!B1:C4" });
    expect(JSON.parse(result.requests[0].body.input).basic_chart.data_range).toBe("'Sales'!A1:C4");
    await expect(capability.preview({ token: 'b', 'chart-type': 'line', 'data-range': 'One!A1:B4,Two!D3:E6' })).rejects.toThrow('Cross-sheet');
});
it('validates snapshot-dependent axis and label settings before chart mutation', async () => {
    const program = sheetsPrograms().find(p => p.id === 'sheets-chart-update')!;
    const request = vi.fn();
    const state = { token: 'b', name: 'chart-config-update', args: { 'chart-id': 'c', 'x-axis-min': 0 }, value: { chart_id: 'c' }, snapshot: { plotArea: { plot: { type: 'line' }, axes: [{ type: 'x', valueType: 'category' }] } } };
    await expect(program.step(state, { lark: { request } } as unknown as CommandContext)).rejects.toThrow('numeric');
    expect(request).not.toHaveBeenCalled();
});
it('routes semantic chart updates in the general batch through snapshot preflight', async () => {
    const start = vi.fn().mockResolvedValue({ workflowId: 'w' });
    const capability = sheetsCapabilities(undefined, { start, resume: vi.fn() }).find(c => c.definition.id === 'sheets.+batch-update')!;
    const request = vi.fn();
    await capability.execute({ token: 'b', operations: [{ shortcut: '+chart-config-update', input: { sheet_id: 's', chart_id: 'c', title: 'A' } }] }, { lark: { request }, selection: {}, grant: {} } as unknown as CommandContext);
    expect(start.mock.calls[0]![0]).toBe('sheets-chart-batch');
    expect(request).not.toHaveBeenCalled();
});
it('returns all canonical chart examples without locator or network access', async () => {
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+chart-create')!;
    const request = vi.fn();
    for (const type of ['column', 'bar', 'line', 'area', 'radar', 'bubble', 'waterfall', 'pareto', 'scatter', 'pie', 'combo']) {
        const example: any = await capability.execute({ 'print-example': type }, { lark: { request } } as unknown as CommandContext);
        expect(example.snapshot.plotArea.plot.type).toBe(type);
        expect(example.snapshot.data.refs[0].value).toContain('Sheet1');
    }
    expect(request).not.toHaveBeenCalled();
});
it('rejects duplicate chart targets inside a mixed general batch', async () => {
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+batch-update')!;
    await expect(capability.preview({ token: 'b', 'continue-on-error': true, operations: [
        { shortcut: '+chart-config-update', input: { sheet_id: 's', chart_id: 'c', title: 'One' } },
        { shortcut: '+chart-config-update', input: { sheet_id: 's', chart_id: 'c', title: 'Two' } },
    ] })).rejects.toThrow('duplicate');
});
it('preserves sheet-qualified detached header references when changing chart data', async () => {
    const { chartPatch } = await import('../src/capabilities/sheets/chart-program');
    const result = chartPatch('chart-data-update', { 'data-range': 'A1:B3', 'header-range': "'Names'!F1:G1" }, { data: {}, plotArea: { plot: { type: 'column' } } });
    expect((result.patch.data as any).dim1.serie.nameRef).toBe("'Names'!F1");
    expect((result.patch.data as any).dim2.series[0].nameRef).toBe("'Names'!G1");
});
it('resolves mixed chart target selectors before snapshot reads or writes', async () => {
    const { chartBatchInput } = await import('../src/capabilities/sheets/chart-batch-input');
    const value = chartBatchInput('batch-chart-update', { operations: [
        { shortcut: '+chart-config-update', input: { sheet_id: 's', chart_id: 'c', title: 'A' } },
        { shortcut: '+chart-config-update', input: { sheet_name: 'Data', chart_id: 'c', title: 'B' } },
    ] }, 'b');
    const request = vi.fn().mockResolvedValue({ output: JSON.stringify({ sheets: [{ sheet_id: 's', sheet_name: 'Data' }] }) });
    const program = sheetsPrograms().find(p => p.id === 'sheets-chart-batch')!;
    await expect(program.step({ token: 'b', value }, { lark: { request } } as unknown as CommandContext)).rejects.toThrow('duplicate');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0].body.tool_name).toBe('get_workbook_structure');
});
it('removes labels from the returned view while sending an explicit deletion patch', async () => {
    const { chartPatch } = await import('../src/capabilities/sheets/chart-program');
    const result = chartPatch('chart-config-update', { 'data-labels': 'none' }, { plotArea: { plot: { type: 'line', labels: { value: true } } } });
    expect((result.patch.plotArea as any).plot.labels).toBeNull();
    expect((result.result.viewModel as any).plotArea.plot).not.toHaveProperty('labels');
});

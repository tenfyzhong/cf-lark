import { it, expect, vi } from 'vitest';
import { sheetsPrograms } from '../src/capabilities/sheets/programs';
import type { CommandContext } from '../src/ports/capabilities';
it('applies declarative styles in semantic order with bounded checkpoints', async () => {
    const program = sheetsPrograms().find(p => p.id === 'sheets-styles-put')!;
    const request = vi.fn().mockResolvedValue({ output: '{"revision":1}' });
    const context = { lark: { request } } as unknown as CommandContext;
    const result = await program.step({ token: 'book', args: { styles: { styles: [{ name: 'Data', cell_merges: ['A1:B1'], cell_styles: [{ range: 'A1:B1', font_weight: 'bold' }], row_sizes: [{ range: '1', height: 24 }], freeze: { rows: 1 } }] } }, offset: 0 }, context);
    expect(request).toHaveBeenCalledTimes(1);
    const input = JSON.parse(request.mock.calls[0]![0].body.input);
    expect(input.operations.map((op: any) => op.tool_name)).toEqual(['merge_cells', 'set_cell_range', 'resize_range', 'modify_sheet_structure']);
    expect(result.done).toBe(true);
});
it('previews declarative style batches using the execution batch bound', async () => {
    const { sheetsCapabilities } = await import('../src/capabilities/sheets/commands');
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+styles-put')!;
    const preview: any = await capability.preview({ token: 'b', styles: [{ name: 'Data', cell_merges: Array.from({ length: 101 }, (_, i) => `A${i + 1}:B${i + 1}`) }] });
    expect(preview.requests).toHaveLength(2);
    expect(JSON.parse(preview.requests[0].body.input).operations).toHaveLength(100);
    expect(JSON.parse(preview.requests[1].body.input).operations).toHaveLength(1);
});

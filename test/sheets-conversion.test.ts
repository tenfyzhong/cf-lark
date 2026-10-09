import { expect, it, vi } from 'vitest';
import { sheetsCapabilities } from '../src/capabilities/sheets/commands';
import type { CommandContext } from '../src/ports/capabilities';
it('pins native workbook exports to sheet and returns a token without output-path', async () => {
    const start = vi.fn().mockResolvedValue({ workflowId: 'w' });
    const capability = sheetsCapabilities(undefined, { start, resume: vi.fn() }).find(c => c.definition.id === 'sheets.+workbook-export')!;
    await capability.execute({ token: 'book' }, { selection: {}, grant: {} } as CommandContext);
    expect(start.mock.calls[0]!.slice(0, 2)).toEqual(['sheets-workbook-export', { phase: 'start', args: { token: 'book', 'doc-type': 'sheet', 'file-extension': 'xlsx', 'skip-download': true } }]);
    await expect(capability.preview({ token: 'book', 'file-extension': 'csv' })).rejects.toThrow('sheet-id');
});
it('accepts artifact-based workbook imports without a spreadsheet locator', async () => {
    const start = vi.fn().mockResolvedValue({ workflowId: 'w' });
    const capability = sheetsCapabilities(undefined, { start, resume: vi.fn() }).find(c => c.definition.id === 'sheets.+workbook-import')!;
    await capability.execute({ file: 'artifact', 'file-name': 'data.xlsx', name: 'Imported' }, { selection: {}, grant: {} } as CommandContext);
    expect(start.mock.calls[0]![0]).toBe('sheets-workbook-import');
    expect(start.mock.calls[0]![1].args).toMatchObject({ file: 'artifact', type: 'sheet', 'file-name': 'data.xlsx', name: 'Imported' });
});
it('reports declared and actual workbook extension after content sniffing', async () => {
    const { workbookConversionPrograms } = await import('../src/capabilities/sheets/conversions');
    const artifacts = { stat: vi.fn().mockResolvedValue({ size: 8 }), read: vi.fn().mockResolvedValue(new Response(new Uint8Array([80, 75, 3, 4, 0, 0, 0, 0]))), upload: vi.fn(), remove: vi.fn() };
    const program = workbookConversionPrograms(artifacts).find(p => p.id === 'sheets-workbook-import')!;
    const context = { selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', revoked: false, expiresAt: Date.now() + 60000, profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }], domains: ['sheets', 'artifact'], permissions: ['read', 'write'] } } as unknown as CommandContext;
    const result: any = await program.step({ phase: 'start', args: { file: 'a', 'file-name': 'data.xls' } }, context);
    expect(result.state.inputCorrections).toEqual([{ field: 'file_extension', declared: 'xls', actual: 'xlsx', reason: 'data.xls is named .xls but its content is a .xlsx workbook; imported as .xlsx' }]);
});

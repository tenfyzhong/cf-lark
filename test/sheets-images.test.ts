import { it, expect, vi } from 'vitest';
import { sheetsCapabilities } from '../src/capabilities/sheets/commands';
import { sheetsPrograms } from '../src/capabilities/sheets/programs';
import type { CommandContext } from '../src/ports/capabilities';
it('creates a floating image from a remote token with full geometry', async () => {
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+float-image-create')!;
    const request = vi.fn().mockResolvedValue({ output: '{"float_image_id":"image"}' });
    await capability.execute({ token: 'b', 'sheet-id': 's', 'image-token': 'img', 'image-name': 'Logo', 'position-row': 1, 'position-col': 'A', 'size-width': 20, 'size-height': 30, 'offset-row': 0 }, { lark: { request } } as unknown as CommandContext);
    expect(JSON.parse(request.mock.calls[0]![0].body.input)).toMatchObject({ operation: 'create', properties: { image_token: 'img', offset: { row_offset: 0 } } });
});
it('rejects multi-cell images before starting upload', async () => {
    const capability = sheetsCapabilities().find(c => c.definition.id === 'sheets.+cells-set-image')!;
    await expect(capability.preview({ token: 'b', range: 'A1:B1', image: 'artifact' })).rejects.toThrow('one cell');
});
it('embeds a completed image upload without repeating the upload', async () => {
    const program = sheetsPrograms().find(p => p.id === 'sheets-image')!;
    const request = vi.fn().mockResolvedValue({ output: '{"revision":2}' });
    const result = await program.step({ token: 'b', phase: 'embed', value: { excel_id: 'b', sheet_id: 's', range: 'A1' }, tool: 'set_cell_range', imageToken: 'img', dimensions: { width: 10, height: 20 } }, { lark: { request } } as unknown as CommandContext);
    expect(result).toMatchObject({ done: true, output: { revision: 2 } });
    expect(JSON.parse(request.mock.calls[0]![0].body.input).cells).toEqual([[{ rich_text: [{ type: 'embed-image', text: '', image_token: 'img', image_width: 10, image_height: 20 }] }]]);
});
it('decodes a WebP artifact before starting upload', async () => {
    const bytes = new Uint8Array(30); const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode('RIFF'), 0); view.setUint32(4, 22, true); bytes.set(new TextEncoder().encode('WEBPVP8X'), 8); view.setUint32(16, 10, true); bytes[24] = 9; bytes[27] = 19;
    const artifacts = { stat: vi.fn().mockResolvedValue({ size: bytes.length }), read: vi.fn().mockResolvedValue(new Response(bytes)), upload: vi.fn(), remove: vi.fn() };
    const program = sheetsPrograms(artifacts).find(p => p.id === 'sheets-image')!;
    const context = { selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', revoked: false, expiresAt: Date.now() + 60000, profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }], domains: ['sheets', 'artifact'], permissions: ['read', 'write'] }, lark: { request: vi.fn() } } as CommandContext;
    expect(await program.step({ phase: 'start', tool: 'set_cell_range', args: { image: 'artifact' } }, context)).toMatchObject({ done: false, state: { dimensions: { width: 10, height: 20 }, phase: 'upload' } });
});

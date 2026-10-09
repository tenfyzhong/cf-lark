import { expect, it, vi } from 'vitest';
import { sheetsCapabilities } from '../src/capabilities/sheets/commands';
import type { CommandContext } from '../src/ports/capabilities';
const context = { selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', revoked: false, expiresAt: Date.now() + 60000, profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }], domains: ['sheets', 'artifact'], permissions: ['read', 'write'] }, lark: { request: vi.fn() } } as CommandContext;
it('resolves grant-owned CSV file aliases before generating the request preview', async () => {
    const artifacts = { stat: vi.fn().mockResolvedValue({ size: 7 }), read: vi.fn().mockResolvedValue(new Response('a,b\n1,2')), upload: vi.fn(), remove: vi.fn() };
    const csv = sheetsCapabilities(artifacts).find(c => c.definition.id === 'sheets.+csv-put')!;
    const result: any = await csv.preview({ token: 'b', 'sheet-id': 's', 'start-cell': 'A1', file: 'artifact' }, context);
    expect(JSON.parse(result.requests[0].body.input).csv).toBe('a,b\n1,2');
    expect(artifacts.read).toHaveBeenCalledWith('g', 'artifact');
});
it('resolves JSON artifacts and rejects missing authorization before reading', async () => {
    const artifacts = { stat: vi.fn().mockResolvedValue({ size: 5 }), read: vi.fn().mockImplementation(() => Promise.resolve(new Response('[[1]]'))), upload: vi.fn(), remove: vi.fn() };
    const cells = sheetsCapabilities(artifacts).find(c => c.definition.id === 'sheets.+cells-set')!;
    const result: any = await cells.preview({ token: 'b', range: 'A1', cells: '@input' }, context);
    expect(JSON.parse(result.requests[0].body.input).cells).toEqual([[{ value: 1 }]]);
    artifacts.read.mockClear();
    await expect(cells.preview({ token: 'b', range: 'A1', cells: '@input' }, { ...context, grant: { ...context.grant, domains: ['sheets'] } })).rejects.toThrow();
    expect(artifacts.read).not.toHaveBeenCalled();
});
it('rejects oversized text artifacts without reading their body', async () => {
    const artifacts = { stat: vi.fn().mockResolvedValue({ size: 20 * 1024 * 1024 + 1 }), read: vi.fn(), upload: vi.fn(), remove: vi.fn() };
    const cells = sheetsCapabilities(artifacts).find(c => c.definition.id === 'sheets.+cells-set')!;
    await expect(cells.preview({ token: 'b', range: 'A1', cells: '@input' }, context)).rejects.toThrow('20 MiB');
    expect(artifacts.read).not.toHaveBeenCalled();
});

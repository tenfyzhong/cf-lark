import { expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import type { CommandContext } from '../src/ports/capabilities';
const args = { 'base-token': 'b', 'table-id': 't', 'form-id': 'f', 'dashboard-id': 'd' };
function command(name: string) { return baseCapabilities().find(c => c.definition.id === `base.+${name}`)!; }
function fixture(data: unknown = {}) { const request = vi.fn().mockResolvedValue(data); return { request, context: { lark: { request } } as unknown as CommandContext }; }
it.each(['create', 'get', 'update', 'delete'])('preserves form %s wire contract', async action => {
    const f = fixture({ id: 'f' });
    const output = await command(`form-${action}`).execute({ ...args, name: ' Survey ', description: 'Description' }, f.context);
    expect(output).toEqual(action === 'delete' ? { deleted: true, form_id: 'f' } : { id: 'f' });
    expect(f.request.mock.calls[0]![0].path).toBe(`/open-apis/base/v3/bases/b/tables/t/forms${action === 'create' ? '' : '/f'}`);
    if (action === 'create' || action === 'update') expect(f.request.mock.calls[0]![0].body).toEqual({ name: ' Survey ', description: 'Description' });
});
it.each(['form', 'dashboard'])('preserves explicit false on %s share settings', async family => {
    const f = fixture({ enabled: false, settings: { enable_auto_analysis: true, other: 1 } });
    const key = family === 'form' ? 'require-login' : 'show-source';
    const output = await command(`${family}-share-update`).execute({ ...args, [key]: false }, f.context);
    expect(f.request.mock.calls[0]![0].body).toEqual({ settings: { [key.replaceAll('-', '_')]: false } });
    expect(output).toEqual({ enabled: false, settings: family === 'form' ? { enable_auto_analysis: true, other: 1 } : { other: 1 } });
    await expect(command(`${family}-share-update`).preview({ ...args, enabled: false, [key]: false })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(command(`${family}-share-update`).preview(args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it.each(['form', 'dashboard'])('reads %s share settings', async family => {
    const f = fixture({ enabled: true });
    expect(await command(`${family}-share-get`).execute(args, f.context)).toEqual({ enabled: true });
    expect(f.request.mock.calls[0]![0].method).toBe('GET');
});
it('returns base metadata under the base envelope', async () => {
    expect(await command('base-get').execute(args, fixture({ name: 'Base' }).context)).toEqual({ base: { name: 'Base' } });
});

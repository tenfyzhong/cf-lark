import { expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import type { CommandContext } from '../src/ports/capabilities';
const args = { 'base-token': 'b', 'dashboard-id': 'd', 'block-id': 'x', 'app-token': 'a' };
function command(name: string) { return baseCapabilities().find(c => c.definition.id === `base.+${name}`)!; }
function fixture(data: unknown = { value: 1 }) { const request = vi.fn().mockResolvedValue(data); return { request, context: { lark: { request } } as unknown as CommandContext }; }
it.each(['list', 'get', 'create', 'update', 'delete', 'arrange', 'block-list', 'block-get', 'block-delete', 'block-get-data'])('matches dashboard %s behavior', async action => {
    const f = fixture();
    const result = await command(`dashboard-${action}`).execute({ ...args, name: ' Board ', 'theme-style': 'future', 'user-id-type': 'open_id' }, f.context);
    const request = f.request.mock.calls[0]![0];
    expect(request.path).toBe('/open-apis/base/v3/bases/b/dashboards' + (['list', 'create'].includes(action) ? '' : action === 'block-get-data' ? '/blocks/x/data' : '/d' + (action === 'arrange' ? '/arrange' : action.startsWith('block') ? '/blocks' + (action === 'block-list' ? '' : '/x') : '')));
    if (action.endsWith('list')) expect(request.query.page_size).toBe(action === 'list' ? 100 : 20);
    if (action === 'create') expect(request.body).toEqual({ name: ' Board ', theme: { theme_style: 'future' } });
    if (action === 'update') expect(request.body).toEqual({ name: 'Board', theme: { theme_style: 'future' } });
    if (action === 'arrange') { expect(request.body).toEqual({}); expect(result).toEqual({ value: 1, arranged: true }); }
    if (action.endsWith('delete')) expect(result).toEqual({ deleted: true, [action.startsWith('block') ? 'block_id' : 'dashboard_id']: action.startsWith('block') ? 'x' : 'd' });
});
it('uses app chart token and explicit base coordinate for computed data', async () => {
    const f = fixture();
    expect(await command('app-block-get-data').execute(args, f.context)).toEqual({ value: 1 });
    expect(f.request).toHaveBeenCalledWith({ method: 'GET', path: '/open-apis/base/v3/base_apps/a/blocks/x/data', query: { base_token: 'b' } });
});

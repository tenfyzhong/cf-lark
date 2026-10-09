import { expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import type { CommandContext } from '../src/ports/capabilities';
function command(name: string) { return baseCapabilities().find(c => c.definition.id === `base.+${name}`)!; }
function fixture(data: unknown = {}) { const request = vi.fn().mockResolvedValue(data); return { request, context: { lark: { request } } as unknown as CommandContext }; }
const args = { 'workspace-token': 'ws/a', 'app-token': 'app/a', 'page-id': 'pg/a', 'block-id': 'bl/a', name: ' Sales ' };
it('creates a workspace and projects returned coordinates', async () => {
    const f = fixture({ workspace_token: ' ws ', url: ' https://example.com ' });
    expect(await command('workspace-create').execute(args, f.context)).toEqual({ workspace: { workspace_token: ' ws ', url: ' https://example.com ' }, created: true, workspace_token: 'ws', url: 'https://example.com' });
    expect(f.request.mock.calls[0]![0].body).toEqual({ name: 'Sales' });
});
it('preserves workspace entity filters and explicit move destination', async () => {
    const f = fixture({ items: [] });
    expect(await command('workspace-entity-list').execute({ ...args, type: ' BASEAPP ', 'page-token': ' next ' }, f.context)).toEqual({ items: [] });
    expect(f.request.mock.calls[0]![0]).toEqual({ method: 'GET', path: '/open-apis/base/v3/workspaces/ws%2Fa/entities', query: { page_size: 30, page_token: 'next', entity_type: 'baseapp' } });
    await command('workspace-move-in').execute({ ...args, 'entity-token': ' entity ' }, f.context);
    expect(f.request.mock.calls[1]![0].body).toEqual({ entity_token: 'entity' });
    await expect(command('workspace-entity-list').preview({ ...args, 'page-size': 31 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('creates an empty app with its selected theme and workspace', async () => {
    const f = fixture({ app_token: 'app' });
    expect(await command('app-create').execute({ ...args, 'theme-style': 'future' }, f.context)).toEqual({ app: { app_token: 'app' }, created: true, workspace_token: 'ws/a' });
    expect(f.request.mock.calls[0]![0].body).toEqual({ name: 'Sales', workspace_token: 'ws/a', theme: { theme_style: 'future' } });
    await expect(command('app-create').preview({ ...args, 'theme-style': 'invented' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it.each(['app-get', 'app-page-get', 'app-block-get', 'app-page-list', 'app-block-list', 'app-page-delete'])('matches %s coordinates and envelope', async name => {
    const f = fixture({ value: 1 });
    const result = await command(name).execute(args, f.context);
    expect(f.request.mock.calls[0]![0].path).toBe(`/open-apis/base/v3/base_apps/app%2Fa${name === 'app-get' ? '' : name === 'app-page-list' ? '/pages' : '/pages/pg%2Fa' + (name.startsWith('app-block') ? '/blocks' + (name.endsWith('get') ? '/bl%2Fa' : '') : '')}`);
    expect(result).toEqual(name === 'app-page-delete' ? { deleted: true, page_id: 'pg/a' } : name === 'app-page-get' ? { page: { value: 1 } } : name === 'app-block-get' ? { block: { value: 1 } } : { value: 1 });
});

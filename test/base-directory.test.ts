import { expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import type { CommandContext } from '../src/ports/capabilities';
function command(name: string) { return baseCapabilities().find(c => c.definition.id === `base.+${name}`)!; }
function fixture(data: unknown = {}) { const request = vi.fn().mockResolvedValue(data); return { request, context: { lark: { request } } as unknown as CommandContext }; }
it('filters directory blocks locally without treating every block as a table', async () => {
    const f = fixture({ blocks: [{ id: 'd', type: 'dashboard' }, { id: 't', type: 'table' }], total: 2 });
    expect(await command('base-block-list').execute({ 'base-token': 'b', 'parent-id': ' folder ', type: 'dashboard' }, f.context)).toEqual({ blocks: [{ id: 'd', type: 'dashboard' }], total: 1 });
    expect(f.request).toHaveBeenCalledWith({ method: 'POST', path: '/open-apis/base/v3/bases/b/blocks/list', body: { parent_id: 'folder' } });
});
it.each(['create', 'move', 'rename', 'delete'])('shapes block %s requests and outputs', async action => {
    const f = fixture({ id: 'block' });
    const args = { 'base-token': 'b', 'block-id': 'block', name: ' New ', type: 'folder' };
    expect(await command(`base-block-${action}`).execute(args, f.context)).toEqual({ block: { id: 'block' }, [{ create: 'created', move: 'moved', rename: 'renamed', delete: 'deleted' }[action]!]: true });
    if (action === 'move') expect(f.request.mock.calls[0]![0].body).toEqual({ parent_id: null });
    if (action === 'create') expect(f.request.mock.calls[0]![0].body).toEqual({ name: 'New', type: 'folder' });
});
it('rejects incompatible block positioning without an upstream request', async () => {
    const f = fixture();
    await expect(command('base-block-move').execute({ 'base-token': 'b', 'block-id': 'x', 'before-id': 'a', 'after-id': 'b' }, f.context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(f.request).not.toHaveBeenCalled();
});
it.each(['list', 'search'])('preserves template %s cursors and projection', async action => {
    const f = fixture({ templates: [1], has_more: true, offset: 'cursor2', extra: 'omit' });
    expect(await command(`template-${action}`).execute({ keyword: ' Projects ', 'category-key': ' office ', 'page-size': 5, offset: ' cursor1 ' }, f.context)).toEqual({ templates: [1], has_more: true, offset: 'cursor2' });
    expect(f.request.mock.calls[0]![0].query).toEqual({ limit: 5, offset: 'cursor1', ...(action === 'list' ? { category_key: 'office' } : { keyword: 'Projects' }) });
});
it('lists categories and rejects empty template searches', async () => {
    expect(await command('template-categories').execute({}, fixture({ categories: [], extra: 1 }).context)).toEqual({ categories: [] });
    await expect(command('template-search').preview({ keyword: ' ' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});

import { describe, expect, it, vi } from 'vitest';
import { baseCapabilities } from '../src/capabilities/base/commands';
import type { CommandContext } from '../src/ports/capabilities';
const args = { 'base-token': 'base/a', 'table-id': 'Tasks', 'view-id': 'Grid', 'field-id': 'Status' };
function fixture(result: unknown = {}) {
    const request = vi.fn().mockResolvedValue(result);
    return { request, context: { lark: { request } } as unknown as CommandContext };
}
function command(name: string) { return baseCapabilities().find(c => c.definition.id === `base.+${name}`)!; }
describe('Base source-derived core shortcuts', () => {
    it('lists tables with compatibility alias and normalizes singleton results', async () => {
        const f = fixture({ id: 'tbl1' });
        expect(await command('table-list').execute({ 'base-token': 'base/a', 'page-size': 5, offset: -1 }, f.context)).toEqual({ tables: [{ id: 'tbl1' }], total: 1 });
        expect(f.request).toHaveBeenCalledWith({ method: 'GET', path: '/open-apis/base/v3/bases/base%2Fa/tables', query: { offset: 0, limit: 5 } });
    });
    it.each(['filter', 'visible-fields', 'group', 'sort', 'timebar', 'card'])('matches view %s get and set envelopes', async property => {
        const f = fixture({ value: 1 });
        const key = property.replaceAll('-', '_');
        expect(await command(`view-get-${property}`).execute(args, f.context)).toEqual({ [key]: { value: 1 } });
        expect(await command(`view-set-${property}`).execute({ ...args, json: '{"config":[]}' }, f.context)).toEqual({ [key]: { value: 1 } });
        expect(f.request).toHaveBeenLastCalledWith({ method: 'PUT', path: `/open-apis/base/v3/bases/base%2Fa/tables/Tasks/views/Grid/${key}`, body: { config: [] } });
        await expect(command(`view-set-${property}`).preview({ ...args, json: '[]' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it.each(['table', 'field', 'view'])('preserves %s delete output and encoded names', async family => {
        const f = fixture();
        const input = { ...args, [`${family}-id`]: 'one/two' };
        expect(await command(`${family}-delete`).execute(input, f.context)).toEqual({ deleted: true, [`${family}_id`]: 'one/two', [`${family}_name`]: 'one/two' });
        expect(f.request.mock.calls[0]![0].path).toContain('one%2Ftwo');
    });
    it('validates pagination before execution and keeps previews free of IO', async () => {
        const f = fixture();
        await expect(command('view-list').execute({ ...args, limit: 201 }, f.context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await command('view-list').preview(args);
        expect(f.request).not.toHaveBeenCalled();
    });
    it('normalizes search option output and query trimming', async () => {
        const f = fixture({ options: [{ name: 'Done' }], total: '10' });
        expect(await command('field-search-options').execute({ ...args, keyword: ' Done ' }, f.context)).toEqual({ field_id: 'Status', field_name: 'Status', keyword: 'Done', options: [{ name: 'Done' }], total: 10 });
        expect(f.request.mock.calls[0]![0].query).toEqual({ offset: 0, limit: 30, query: 'Done' });
    });
});
it('preserves the field legacy default and view write scope', async () => {
    const f = fixture({ fields: [] });
    await command('field-list').execute(args, f.context);
    expect(f.request.mock.calls[0]![0].query).toEqual({ offset: 0, limit: 300 });
    expect(command('view-delete').definition.scopes).toEqual(['base:view:write_only']);
});
it('keeps identity and permission metadata aligned to the pinned registry', async () => {
    const { default: coverage } = await import('../docs/generated/coverage.json');
    for (const capability of baseCapabilities()) {
        const upstream = coverage.shortcutCommands.find(command => command.id === capability.definition.id)!;
        expect(upstream, capability.definition.id).toBeDefined();
        expect(capability.definition.identities, capability.definition.id).toEqual(upstream.identities);
        expect([...capability.definition.scopes].sort(), capability.definition.id).toEqual([...new Set([...(upstream.userScopes ?? []), ...(upstream.botScopes ?? [])])].sort());
        const properties = capability.definition.inputSchema.properties as Record<string, unknown>;
        for (const flag of upstream.flags) expect(properties, `${capability.definition.id}:${flag}`).toHaveProperty(flag);
    }
});

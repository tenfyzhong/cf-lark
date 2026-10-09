import { expect, it, vi } from 'vitest';
import { appsCapabilities } from '../src/capabilities/apps/commands';
import type { CommandContext } from '../src/ports/capabilities';
function fixture(name: string, data: Record<string, unknown> = {}) {
    const request = vi.fn().mockResolvedValue(data);
    const capability = appsCapabilities().find((item) => item.definition.id === `apps.+${name}`)!;
    return { request, run: (args: Record<string, unknown> = {}) => capability.execute({ 'app-id': 'a', ...args }, { lark: { request } } as unknown as CommandContext) };
}
it('projects database table metadata and encodes table detail path', async () => {
    const f = fixture('db-table-list', { items: [{ name: 'orders', columns: [{}, {}], size_bytes: 0, extra: true }], page_token: 'n' });
    expect(await f.run()).toEqual({ items: [{ name: 'orders', description: '', column_count: 2, size_bytes: 0 }], page_token: 'n' });
    expect(f.request.mock.calls[0]![0].query).toEqual({ page_size: 20 });
    const detail = fixture('db-table-get', { columns: [] });
    expect(await detail.run({ table: 'a/b', environment: 'online' })).toEqual({ columns: [] });
    expect(detail.request.mock.calls[0]![0]).toEqual({ method: 'GET', path: '/open-apis/spark/v1/apps/a/tables/a%2Fb', query: { env: 'online' } });
});
it('normalizes audit status and empty requested table fallback', async () => {
    expect(await fixture('db-audit-status', { items: [] }).run({ table: 'orders' })).toEqual({ table: 'orders', enabled: false });
    expect(await fixture('db-audit-status', { items: [{ table: 'orders', enabled: true, enabled_at: 'now', retention: '7d', extra: 1 }] }).run()).toEqual({ items: [{ table: 'orders', enabled: true, enabled_at: 'now', retention: '7d' }] });
});
it('omits unavailable quota and rounds percentage', async () => {
    expect(await fixture('db-quota-get', { storage_used_bytes: 10, storage_quota_bytes: 0, tables: 1 }).run()).toEqual({ storage_used_bytes: 10, tables: 1 });
    expect(await fixture('db-quota-get', { storage_used_bytes: 1, storage_quota_bytes: 3, usage_percent: 33.333, views: 0 }).run()).toEqual({ storage_used_bytes: 1, storage_quota_bytes: 3, usage_percent: 33.3, views: 0 });
});
it.each([
    ['db-sync-get', { 'task-id': 't' }, 'GET', 'sync_task', { task_id: 't' }, undefined],
    ['db-sync-list', { mode: 'batch', table: 'orders' }, 'GET', 'sync_list', { page_size: 20, mode: 'batch', table: 'orders' }, undefined],
    ['db-sync-enable', { 'task-id': 't' }, 'POST', 'sync_enable', undefined, { task_id: 't' }],
    ['db-sync-disable', { 'task-id': 't' }, 'POST', 'sync_disable', undefined, { task_id: 't' }],
    ['db-sync-delete', { 'task-id': 't', yes: true }, 'POST', 'sync_del', undefined, { task_id: 't' }],
] as const)('preserves %s requests and responses', async (name, args, method, suffix, query, body) => {
    const f = fixture(name, { task_id: 't' });
    expect(await f.run(args)).toEqual({ task_id: 't' });
    expect(f.request.mock.calls[0]![0]).toEqual({ method, path: `/open-apis/spark/v1/apps/a/db/${suffix}`, ...(query ? { query } : {}), ...(body ? { body } : {}) });
});
it('guards irreversible environment initialization and sends only sync_data', async () => {
    const f = fixture('db-env-create');
    await expect(f.run()).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    await expect(f.run({ environment: 'online', yes: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await f.run({ 'sync-data': true, yes: true });
    expect(f.request).toHaveBeenCalledWith({ method: 'POST', path: '/open-apis/spark/v1/apps/a/db_dev_init', body: { sync_data: true } });
});
it('rejects legacy environment and invalid page sizes', async () => {
    const f = fixture('db-sync-list');
    await expect(f.run({ env: 'dev' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(f.run({ 'page-size': 0 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(f.request).not.toHaveBeenCalled();
});
it('uses reported quota percentage without inventing missing measurements', async () => {
    expect(await fixture('db-quota-get', { storage_used_bytes: 1, storage_quota_bytes: 3 }).run()).not.toHaveProperty('usage_percent');
    expect(await fixture('db-quota-get', { storage_used_bytes: 1, storage_quota_bytes: 3, usage_percent: '180.555' }).run()).toHaveProperty('usage_percent', 180.6);
});

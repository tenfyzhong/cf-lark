import { expect, it, vi } from 'vitest';
import { appsCapabilities } from '../src/capabilities/apps/commands';
const config = { mode: 'batch', source: { type: 'base', base_url: 'https://host/base/a?table=tbl1' }, target: { type: 'postgresql', table: { name: 'orders', action: 'create' } } };
function fixture(name: string) {
    const request = vi.fn().mockResolvedValue({ task_id: 't' }), c = appsCapabilities().find((c) => c.definition.id === `apps.+${name}`)!;
    return { request, run: (args = {}) => c.execute({ 'app-id': 'a', config: JSON.stringify(config), ...args }, { lark: { request } } as any) };
}
it('allows create preview without confirmation and sends environment in body', async () => {
    const f = fixture('db-sync-create'); expect(await f.run({ preview: true, environment: 'dev' })).toEqual({ task_id: 't' });
    expect(f.request.mock.calls[0]![0]).toEqual({ method: 'POST', path: '/open-apis/spark/v1/apps/a/db/sync_create', body: { config, preview: true, env: 'dev' } });
});
it('requires confirmation for committed tasks but permits omitted mappings on create', async () => {
    const f = fixture('db-sync-create'); await expect(f.run()).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    await f.run({ yes: true }); expect(f.request).toHaveBeenCalledOnce();
});
it.each([
    { field_map: [] }, { option_mapping: {} }, { field_maps: null }, { field_maps: [{ enabled: false }] },
    { schema_only: true, mode: 'streaming' }, { source: { type: 'base' } },
    { field_maps: [{ option_mapping: {} }] },
])('rejects invalid config before side effects %j', async (patch) => {
    const f = fixture('db-sync-create'); await expect(f.run({ config: JSON.stringify({ ...config, ...patch }), yes: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' }); expect(f.request).not.toHaveBeenCalled();
});
it('requires enabled mappings on update but does not require source table identity', async () => {
    const f = fixture('db-sync-update'); await expect(f.run({ 'task-id': ' t ', yes: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    const cfg = { ...config, source: { type: 'base' }, field_maps: [{}] };
    await f.run({ 'task-id': ' t ', config: JSON.stringify(cfg), yes: true });
    expect(f.request.mock.calls[0]![0]).toEqual({ method: 'PUT', path: '/open-apis/spark/v1/apps/a/db/sync_update', body: { task_id: 't', config: cfg } });
});
it('saves resolved preview configuration into a private artifact', async () => {
    const { appsPrograms } = await import('../src/capabilities/apps/programs');
    const upload = vi.fn().mockResolvedValue({ id: 'resolved' }), request = vi.fn().mockResolvedValue({ config, summary: {} });
    const program = appsPrograms({ artifacts: { upload }, remoteFiles: {} } as any).find((p) => p.id === 'apps-db-sync-create')!;
    const selection = { profileId: 'p', accountId: 'a', identity: 'user' }, grant = { id: 'g', revoked: false, expiresAt: Date.now() + 10000, profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], domains: ['apps', 'artifact'], permissions: ['read', 'write'] };
    const result = await program.step({ args: { 'app-id': 'a', config: JSON.stringify(config), preview: true, output: 'resolved.json' } }, { selection, grant, lark: { request } } as any);
    expect(result).toEqual({ done: true, output: { config, summary: {}, output: 'resolved', artifactId: 'resolved' } });
    expect(upload).toHaveBeenCalledWith('g', expect.any(Number), expect.any(ReadableStream));
});

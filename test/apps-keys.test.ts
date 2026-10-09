import { expect, it, vi } from 'vitest';
import { appsCapabilities } from '../src/capabilities/apps/commands';
import type { CommandContext } from '../src/ports/capabilities';
function fixture(name: string, data: Record<string, unknown> = {}) {
    const request = vi.fn().mockResolvedValue(data);
    const capability = appsCapabilities().find((item) => item.definition.id === `apps.+openapi-key-${name}`)!;
    return { request, capability, run: (args: Record<string, unknown> = {}) => capability.execute({ 'app-id': ' a/b ', 'key-id': 'k/x', ...args }, { lark: { request } } as unknown as CommandContext) };
}
it.each(['get', 'update', 'enable', 'disable'])('redacts %s key responses', async (action) => {
    const f = fixture(action, { info: { api_key: 'super-secret-key', name: 'N' } });
    expect(await f.run(action === 'update' ? { 'allow-preview': false } : {})).toEqual({ info: { name: 'N', key_preview: '****-key' } });
    expect(f.request.mock.calls[0]![0].path).toBe('/open-apis/spark/v1/apps/a%2Fb/oapi_apikeys/k%2Fx');
    if (action === 'update') expect(f.request.mock.calls[0]![0].body).toEqual({ config: { is_allow_access_preview: false } });
});
it('redacts list and retains explicit zero pagination', async () => {
    const f = fixture('list', { infos: [{ api_key: 'abcd' }, { api_key_id: 'a' }] });
    expect(await f.run({ limit: 0, offset: 0 })).toEqual({ infos: [{ key_preview: '****' }, { api_key_id: 'a', key_preview: '****' }] });
    expect(f.request.mock.calls[0]![0].query).toEqual({ limit: 0, offset: 0 });
});
it('issues secrets only for create and reset with documented scope bodies', async () => {
    const f = fixture('create', { info: { api_key: 'new-secret', api_key_id: 'id' } });
    expect(await f.run({ name: ' N ', 'scope-api': ['get /openapi/orders'], 'allow-preview': false })).toEqual({ api_key: 'new-secret', api_key_id: 'id', info: { api_key_id: 'id', key_preview: '****cret' } });
    expect(f.request.mock.calls[0]![0].body).toEqual({ name: 'N', config: { request_scope: { allow_all: false, http_infos: [{ http_method: 'GET', http_path: '/openapi/orders' }] }, is_allow_access_preview: false } });
    const reset = fixture('reset', { api_key: 'new', api_key_id: 'id' });
    await expect(reset.run()).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(await reset.run({ yes: true })).toMatchObject({ api_key: 'new', api_key_id: 'id' });
    expect(reset.request.mock.calls[0]![0].path).toMatch(/\/refresh$/);
});
it.each([
    { scope: '{"allow_all":true}', 'scope-all': true },
    { scope: '{"undocumented":true}' },
    { scope: '[]' },
    { scope: '{"http_infos":[{"http_method":"GET","http_path":"/ok","extra":1}]}' },
    { 'scope-api': ['TRACE /openapi/x'] },
    { 'scope-api': ['GET /openapi/../x'] },
    { 'scope-api': ['GET //host'] },
    { 'scope-api': ['GET https://host'] },
])('rejects unsafe or conflicting key scopes before network: %j', async (args) => {
    const f = fixture('create');
    await expect(f.run({ name: 'N', ...args })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(f.request).not.toHaveBeenCalled();
});
it('deletes keys only after explicit confirmation', async () => {
    const f = fixture('delete');
    await expect(f.run()).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(await f.run({ yes: true })).toEqual({ api_key_id: 'k/x', deleted: true });
});

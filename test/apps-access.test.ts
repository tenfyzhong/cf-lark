import { expect, it, vi } from 'vitest';
import { appsCapabilities } from '../src/capabilities/apps/commands';
import type { CommandContext } from '../src/ports/capabilities';
function fixture(name: string, data: Record<string, unknown> = {}) {
    const request = vi.fn().mockResolvedValue(data);
    const capability = appsCapabilities().find((item) => item.definition.id === `apps.+${name}`)!;
    return { request, capability, run: (args: Record<string, unknown> = {}) => capability.execute(args, { lark: { request } } as unknown as CommandContext) };
}
it('maps specific access targets into typed arrays and approval configuration', async () => {
    const f = fixture('access-scope-set');
    await f.run({ 'app-id': 'a', scope: 'specific', targets: '[{"type":"user","id":" u "},{"type":"department","id":"d"},{"type":"chat","id":"c"}]', 'apply-enabled': true, approver: ' approver ' });
    expect(f.request.mock.calls[0]![0]).toEqual({ method: 'PUT', path: '/open-apis/spark/v1/apps/a/access-scope', body: { scope: 'Range', users: ['u'], departments: ['d'], chats: ['c'], apply_config: { enabled: true, approvers: ['approver'] } } });
});
it('requires explicit public login choice and preserves false', async () => {
    const f = fixture('access-scope-set');
    await expect(f.run({ 'app-id': 'a', scope: 'public' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await f.run({ 'app-id': 'a', scope: 'public', 'require-login': false });
    expect(f.request.mock.calls[0]![0].body).toEqual({ scope: 'All', require_login: false });
    expect(await fixture('access-scope-get', { scope: 'Range', users: ['u'] }).run({ 'app-id': 'a' })).toEqual({ scope: 'Range', users: ['u'] });
});
it.each([{ scope: 'specific', targets: '[]' }, { scope: 'tenant', targets: '[]' }, { scope: 'specific', targets: '[{"type":"user","id":"u"}]', approver: 'u' }])('rejects conflicting access options %j', async (args) => {
    const f = fixture('access-scope-set'); await expect(f.run({ 'app-id': 'a', ...args })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' }); expect(f.request).not.toHaveBeenCalled();
});
it('converts duplicate IDs by position and reports misses', async () => {
    const f = fixture('user-id-convert', { items: [{ source_id: 'u', target_id: 1 }, { source_id: 'u', target_id: 2 }] });
    expect(await f.run({ 'convert-type': 'open-id-to-miaoda', ids: 'u,u,missing\n' })).toEqual({ convert_type: 'open-id-to-miaoda', items: [{ index: 0, source_id: 'u', target_id: '1' }, { index: 1, source_id: 'u', target_id: '2' }], missed: [{ index: 2, source_id: 'missing', reason: 'not_found' }] });
    expect(f.request.mock.calls[0]![0]).toEqual({ method: 'POST', path: '/open-apis/spark/v1/directory/user/id_convert', body: { id_convert_type: 20, ids: ['u', 'u', 'missing'] } });
    expect(f.capability.definition.identities).toEqual(['user', 'bot']);
});
it.each(['a,,b', ',a', Array(101).fill('a').join(','), ''])('rejects position-breaking conversion batches', async (ids) => {
    const f = fixture('user-id-convert'); await expect(f.run({ 'convert-type': 'open-id-to-miaoda', ids })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' }); expect(f.request).not.toHaveBeenCalled();
});

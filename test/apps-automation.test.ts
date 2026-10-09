import { expect, it, vi } from 'vitest';
import { appsCapabilities } from '../src/capabilities/apps/commands';
import { appsPrograms } from '../src/capabilities/apps/programs';
import type { CommandContext } from '../src/ports/capabilities';
function fixture(action: string, data: Record<string, unknown> = {}) {
    const request = vi.fn().mockResolvedValue(data);
    const capability = appsCapabilities().find((item) => item.definition.id === `apps.+automation-${action}`)!;
    return { request, run: (args: Record<string, unknown> = {}) => capability.execute({ 'app-id': 'app_a', name: 't', ...args }, { lark: { request } } as unknown as CommandContext) };
}
it.each([
    [{ 'trigger-type': 'cron', cron: '*/30 * * * *' }, { name: 't', trigger_type: 'cron', cron_condition: { cron: '*/30 * * * *', timezone: 'Asia/Shanghai' } }],
    [{ 'trigger-type': 'record-change', table: 'orders', event: 'update', fields: '["a"]' }, { name: 't', trigger_type: 'record_change', record_change_condition: { table: 'orders', event: 'UPDATE', fields: ['a'] } }],
    [{ 'trigger-type': 'webhook' }, { name: 't', trigger_type: 'webhook', webhook_condition: { white_ip_list: [] } }],
    [{ 'trigger-type': 'feishu-approval', 'event-type': 'approval_instance', 'instance-status': [' approved '] }, { name: 't', trigger_type: 'feishu_approval', feishu_approval_condition: { event_type: 'approval_instance', status: ['APPROVED'] } }],
])('composes validated trigger families', async (args, body) => {
    const f = fixture('create', { trigger: { trigger_condition: { token_value: 'secret' } } });
    expect(await f.run(args)).toEqual({ trigger: { trigger_condition: { token_value: null } } });
    expect(f.request.mock.calls[0]![0].body).toEqual(body);
});
it.each(['* * * * *', '*/45 * * * *', '0,20 * * * *', '1-59/10 * * * *'])('rejects cron intervals below 30 minutes', async (cron) => {
    const f = fixture('create'); await expect(f.run({ 'trigger-type': 'cron', cron })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' }); expect(f.request).not.toHaveBeenCalled();
});
it.each([{ 'trigger-type': 'webhook', cron: '0 * * * *' }, { 'trigger-type': 'record-change', table: 't', event: 'BOGUS' }, { 'trigger-type': 'webhook', 'white-ip-list': '["10.0.0.256"]' }])('rejects invalid or mixed conditions', async (args) => {
    await expect(fixture('create').run(args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('updates conditions and dispatches token actions without leaking normal responses', async () => {
    const f = fixture('update', { trigger_condition: { token_value: 'secret' } });
    await expect(f.run({ description: 'D' })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(await f.run({ description: 'D', yes: true })).toEqual({ trigger_condition: { token_value: null } });
    expect(f.request.mock.calls[0]![0].method).toBe('PUT');
    const token = fixture('update', { token_value: 'new' });
    expect(await token.run({ 'enable-token': true, yes: true })).toEqual({ token_value: 'new', token_enabled: true });
    expect(token.request.mock.calls[0]![0]).toMatchObject({ method: 'PATCH', path: '/open-apis/spark/v1/apps/app_a/triggers/t/webhook/token/status', body: { status: 'enabled', token_type: 'bearerToken' } });
});
it.each([{ timezone: 'UTC' }, { 'app-env': 'preview' }, { 'reset-token': true, description: 'D' }, { 'enable-token': true, 'disable-token': true }])('rejects silently ignored update fields', async (args) => {
    await expect(fixture('update').run({ ...args, yes: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('supports get/enable/disable on the parent trigger resource', async () => {
    for (const action of ['get', 'enable', 'disable']) {
        const f = fixture(action, { success: true }); await f.run();
        expect(f.request.mock.calls[0]![0].path).toBe('/open-apis/spark/v1/apps/app_a/triggers/t');
        if (action !== 'get') expect(f.request.mock.calls[0]![0].body).toEqual({ status: action === 'enable' ? 'enabled' : 'disabled' });
    }
});
it('aggregates bounded pages and rejects a repeated cursor', async () => {
    const program = appsPrograms().find((program) => program.id === 'apps-automation-list')!;
    const request = vi.fn().mockResolvedValueOnce({ items: [{ trigger_condition: { token_value: 'secret' } }], has_more: true, page_token: 'next' }).mockResolvedValueOnce({ items: [{ name: 'b' }], has_more: false });
    const context = { lark: { request } } as unknown as CommandContext;
    const first = await program.step({ args: { 'app-id': 'a' }, items: [], seen: [], pages: 0 }, context);
    expect(first.done).toBe(false);
    if (first.done) throw new Error('Expected a checkpoint.');
    expect(request).toHaveBeenCalledOnce();
    const second = await program.step(first.state, context);
    expect(second).toEqual({ done: true, output: { items: [{ trigger_condition: { token_value: null } }, { name: 'b' }], has_more: false, page_token: null } });
    request.mockResolvedValue({ items: [], has_more: true, page_token: 'next' });
    await expect(program.step(first.state, context)).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
});

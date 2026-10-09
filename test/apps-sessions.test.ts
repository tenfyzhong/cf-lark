import { expect, it, vi } from 'vitest';
import { appsCapabilities } from '../src/capabilities/apps/commands';
import type { CommandContext } from '../src/ports/capabilities';
function fixture(name: string, data: Record<string, unknown> = {}) {
    const request = vi.fn().mockResolvedValue(data);
    const capability = appsCapabilities().find((item) => item.definition.id === `apps.+${name}`)!;
    return { request, capability, run: (args: Record<string, unknown> = {}) => capability.execute({ 'app-id': 'a', ...args }, { lark: { request } } as unknown as CommandContext) };
}
it.each([
    ['session-create', {}, 'POST', '/sessions', undefined, undefined],
    ['session-list', { 'page-token': ' n ' }, 'GET', '/sessions', { page_size: 20, page_token: 'n' }, undefined],
    ['session-get', { 'session-id': ' s/x ' }, 'GET', '/sessions/s%2Fx', undefined, undefined],
    ['session-stop', { 'session-id': 's', 'turn-id': ' t ' }, 'POST', '/sessions/s/stop', undefined, { turn_id: 't' }],
    ['session-messages-list', { 'session-id': 's', 'turn-id': 't/x', 'page-token': 'n' }, 'GET', '/sessions/s/turns/t%2Fx/reply_message', { page_token: 'n' }, undefined],
    ['chat', { 'session-id': 's', message: ' Build app ' }, 'POST', '/sessions/s/chat', undefined, { message: 'Build app' }],
    ['release-list', { status: 'failed' }, 'GET', '/releases', { page_size: 20, status: 'failed' }, undefined],
] as const)('preserves %s asynchronous and paging contracts', async (name, args, method, suffix, query, body) => {
    const data = { accepted: true, next_poll_after_ms: 5000 };
    const f = fixture(name, data);
    expect(await f.run(args)).toEqual(data);
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.request.mock.calls[0]![0]).toEqual({ method, path: `/open-apis/spark/v1/apps/a${suffix}`, ...(query ? { query } : {}), ...(body ? { body } : {}) });
});
it('rejects blank message and missing target handles before network', async () => {
    for (const name of ['session-get', 'session-stop', 'session-messages-list', 'chat']) {
        const f = fixture(name);
        await expect(f.run()).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(f.request).not.toHaveBeenCalled();
    }
});
it('preserves release reason and projects creation output', async () => {
    const f = fixture('release-create', { release_id: 'r', status: 'publishing', sync: false, omitted: true });
    expect(await f.run({ 'app-id': 'app_a', branch: ' b ', 'apply-reason': ' reason ' })).toEqual({ release_id: 'r', status: 'publishing', sync: false });
    expect(f.request.mock.calls[0]![0].body).toEqual({ branch: 'b', apply_reason: ' reason ' });
});
it.each([' ', 'line\nnew', 'x'.repeat(1001), 'invisible\u202e'])('rejects invalid release reasons', async (reason) => {
    const f = fixture('release-create');
    await expect(f.run({ 'app-id': 'app_a', 'apply-reason': reason })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(f.request).not.toHaveBeenCalled();
});
it('normalizes release approval aliases and outer auxiliary precedence', async () => {
    const f = fixture('release-get', { release: { release_id: 'r', status: 'failed', error_logs: ['inner'] }, error_logs: ['outer'], current_node_info: { currentNode: 'approval', currentStatus: 'pending', result: { approvalURL: 'https://example.test' }, submittedBy: { openID: 'ou_1' }, extra: true } });
    expect(await f.run({ 'app-id': 'app_a', 'release-id': 'r' })).toEqual({ release_id: 'r', status: 'failed', error_logs: ['outer'], current_node_info: { current_node: 'approval', current_status: 'pending', result: { approval_url: 'https://example.test' }, submitted_by: { open_id: 'ou_1' }, extra: true } });
});

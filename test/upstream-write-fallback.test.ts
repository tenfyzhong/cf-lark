import { expect, it, vi } from 'vitest';
import { LarkHttpClient } from '../src/infrastructure/lark/http-client';
import { appsPrograms } from '../src/capabilities/apps/programs';
import { applicationCapabilities } from '../src/capabilities/application/commands';
import type { CommandContext } from '../src/ports/capabilities';

it.each([429, 503])('does not resume audit POST contention from an HTTP %s error message', async (status) => {
    vi.useFakeTimers();
    try {
        const send = vi.fn(async () => Response.json({ msg: 'k_dl_1600039 lock already held' }, { status, headers: { 'Retry-After': '60' } }));
        const lark = new LarkHttpClient('feishu', async () => 'fixture-token', send);
        const program = appsPrograms().find(item => item.id === 'apps-db-audit-enable')!;
        const context = { lark } as unknown as CommandContext;
        let failure: unknown;
        try {
            const step = await program.step({ args: { 'app-id': 'a', table: 't' } }, context);
            if (!step.done) { vi.advanceTimersByTime(500); await program.step(step.state, context); }
        } catch (error) { failure = error; }
        expect(send).toHaveBeenCalledOnce();
        expect(failure).toMatchObject({ code: 'UPSTREAM_HTTP_ERROR', details: { retryable: false, retry_after_seconds: 60 } });
    } finally { vi.useRealTimers(); }
});

it('does not turn an HTTP collision message into a force-create PATCH fallback', async () => {
    const send = vi.fn(async (request: Request) => request.method === 'POST'
        ? Response.json({ code: 40000000, msg: 'command already exists' }, { status: 503 })
        : Response.json({ code: 0, data: { items: [{ command: 'hello', command_id: 'id' }] } }));
    const lark = new LarkHttpClient('feishu', async () => 'fixture-token', send);
    const command = applicationCapabilities().find(item => item.definition.id === 'application.+slash-command-create')!;
    await expect(command.execute({ command: 'hello', description: 'Greeting', force: true }, { lark } as unknown as CommandContext))
        .rejects.toMatchObject({ code: 'UPSTREAM_HTTP_ERROR', details: { retryable: false } });
    expect(send).toHaveBeenCalledOnce();
});

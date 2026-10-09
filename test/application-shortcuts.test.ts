import { expect, it, vi } from 'vitest';
import { applicationCapabilities } from '../src/capabilities/application/commands';
import { ServiceError } from '../src/domain/errors';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';

const base = '/open-apis/application/v7/app_slash_commands';
function setup() {
    const request = vi.fn(async (_request: unknown): Promise<JsonObject> => ({ command_id: 'id', command: 'hello' }));
    const context = { lark: { request }, selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', expiresAt: 0, revoked: false, profiles: [], domains: [], permissions: [] } } satisfies CommandContext;
    const command = (name: string) => applicationCapabilities().find((item) => item.definition.id === `application.+slash-command-${name}`)!;
    return { request, command, context };
}
it('lists normalized items and creates correctly nested localized descriptions and top-level icons', async () => {
    const { request, command, context } = setup();
    request.mockResolvedValueOnce({ items: [{ command: 'hello' }] });
    expect(await command('list').execute({}, context)).toEqual({ items: [{ command: 'hello' }], count: 1 });
    const args = { command: ' hello ', description: 'Greeting', 'description-i18n': ['en_us=Hello=world', 'en_gb=Greetings'], 'icon-key': 'skill_outlined' };
    expect(await command('create').preview(args)).toMatchObject({ requests: [{ method: 'POST', path: base, body: { command: 'hello', description: { default_value: 'Greeting', i18n: { en_us: 'Hello=world', en_gb: 'Greetings' } }, icon: { icon_key: 'skill_outlined' } } }] });
    expect(await command('create').execute(args, context)).toMatchObject({ action: 'created', command_id: 'id' });
    expect(request).toHaveBeenCalledTimes(2);
});
it('resolves name targets uniquely and encodes explicit IDs for patch/delete', async () => {
    const { request, command, context } = setup();
    request.mockResolvedValueOnce({ items: [{ command: 'hello', command_id: 'a/b' }] });
    await command('update').execute({ command: 'hello', description: 'New' }, context);
    expect(request).toHaveBeenLastCalledWith({ method: 'PATCH', path: `${base}/a%2Fb`, body: { description: { default_value: 'New' } } });
    expect(await command('delete').execute({ 'command-id': ' x/y ' }, context)).toEqual({ action: 'deleted', command_id: 'x/y' });
    expect(request).toHaveBeenLastCalledWith({ method: 'DELETE', path: `${base}/x%2Fy` });
});
it('upserts only an explicitly forced known collision and never repeats POST', async () => {
    const { request, command, context } = setup();
    const collision = new ServiceError('UPSTREAM_ERROR', 'Rejected', 502, { upstreamCode: 40000000, reason: 'command_already_exists' });
    request.mockRejectedValueOnce(collision);
    await expect(command('create').execute({ command: 'hello', description: 'Greeting' }, context)).rejects.toBe(collision);
    expect(request).toHaveBeenCalledTimes(1);
    request.mockRejectedValueOnce(collision).mockResolvedValueOnce({ items: [{ command: 'hello', command_id: 'id' }] });
    expect(await command('create').execute({ command: 'hello', description: 'Greeting', force: true }, context)).toMatchObject({ action: 'updated' });
    expect(request).toHaveBeenLastCalledWith({ method: 'PATCH', path: `${base}/id`, body: { description: { default_value: 'Greeting' } } });
    request.mockRejectedValueOnce(new ServiceError('UPSTREAM_ERROR', 'Other failure', 502, { upstreamCode: 40000000 }));
    await expect(command('create').execute({ command: 'hello', description: 'Greeting', force: true }, context)).rejects.toThrow('Other failure');
    expect(request).toHaveBeenCalledTimes(5);
});
it.each([
    ['create', { command: '/hello', description: 'Greeting' }],
    ['create', { command: 'hello', description: ' ' }],
    ['create', { command: 'hello', description: 'Greeting', 'description-i18n': ['en_us=a', 'en_us=b'] }],
    ['create', { command: 'hello', description: 'Greeting', 'description-i18n': ['=value'] }],
    ['update', { command: 'hello', 'command-id': 'id', description: 'New' }],
    ['update', { command: 'hello', 'description-i18n': ['en_us=New'] }],
    ['update', { command: 'hello' }],
    ['delete', {}],
] as const)('validates %s identically in preview and execution', async (name, args) => {
    const { request, command, context } = setup();
    await expect(command(name).preview(args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(command(name).execute(args, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(request).not.toHaveBeenCalled();
});
it.each([{ items: [] }, { items: [{ command: 'hello', command_id: 'a' }, { command: 'hello', command_id: 'b' }] }])('refuses missing or ambiguous name matches without mutation', async ({ items }) => {
    const { request, command, context } = setup();
    request.mockResolvedValue({ items });
    await expect(command('delete').execute({ command: 'hello' }, context)).rejects.toThrow();
    expect(request).toHaveBeenCalledExactlyOnceWith({ method: 'GET', path: base });
});

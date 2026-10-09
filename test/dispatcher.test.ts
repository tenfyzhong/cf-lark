import { describe, expect, it, vi } from 'vitest';
import { Dispatcher } from '../src/application/dispatcher';
import { Registry } from '../src/capabilities/registry';
import { fixtureValidator } from './support/schema-validator';
import type { Grant } from '../src/domain/models';

describe('command execution boundary', () => {
    const grant: Grant = {
        id: 'g', expiresAt: 2000, revoked: false,
        profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }],
        domains: ['calendar'], permissions: ['read'],
    };
    const make = () => {
        const handler = vi.fn(async () => ({ items: [1] }));
        const preview = vi.fn(async (args: unknown) => ({ planned: args }));
        const request = vi.fn();
        const client = vi.fn(async () => ({ request }));
        const registry = new Registry([{
            definition: { id: 'calendar.list', domain: 'calendar', description: 'List calendars',
                inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1 } }, required: ['limit'], additionalProperties: false },
                identities: ['user'], scopes: [], risk: 'read', source: 'api' },
            execute: handler,
            preview,
        }]);
        return { handler, client, preview, dispatcher: new Dispatcher(registry, fixtureValidator(), client, () => 1000) };
    };
    const input = { command: 'calendar.list', args: { limit: 3 }, profileId: 'p', accountId: 'a', identity: 'user' as const };

    it('authorizes and validates before constructing an upstream client', async () => {
        const { dispatcher, client, handler } = make();
        await expect(dispatcher.execute({ ...input, profileId: 'other' }, grant)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(dispatcher.execute({ ...input, args: { limit: 0 } }, grant)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(client).not.toHaveBeenCalled();
        expect(handler).not.toHaveBeenCalled();
    });
    it('does not execute or request credentials in dry-run mode', async () => {
        const { dispatcher, client, handler, preview } = make();
        expect(await dispatcher.execute({ ...input, dryRun: true }, grant)).toMatchObject({ ok: true, data: { planned: { limit: 3 } } });
        expect(client).not.toHaveBeenCalled();
        expect(handler).not.toHaveBeenCalled();
        expect(preview).toHaveBeenCalledWith(input.args, { selection: { profileId: 'p', accountId: 'a', identity: 'user' }, grant });
    });
    it('executes a valid authorized command', async () => {
        const { dispatcher, handler } = make();
        expect(await dispatcher.execute(input, grant)).toMatchObject({ ok: true, identity: 'user', data: { items: [1] } });
        expect(handler).toHaveBeenCalledOnce();
    });
    it('hides commands outside the grant', () => {
        const { dispatcher } = make();
        expect(dispatcher.search({ query: 'cal' }, grant).commands).toHaveLength(1);
        expect(dispatcher.search({ query: '' }, { ...grant, domains: ['mail'] }).commands).toHaveLength(0);
        expect(() => dispatcher.schema('calendar.list', { ...grant, revoked: true })).toThrow();
    });
    it('exposes grant-scoped identifiers in discovery and command schemas', () => {
        const { dispatcher } = make();
        const expected = { profiles: [{ profileId: 'p', accountIds: ['a'], identities: ['user'] }] };
        expect(dispatcher.search({ query: 'cal' }, grant)).toMatchObject({ executionContext: expected });
        expect(dispatcher.schema('calendar.list', grant)).toMatchObject({ executionContext: expected });
        expect(() => dispatcher.search({ query: '' }, { ...grant, revoked: true })).toThrow();
    });
    it('uses the single authorized profile and account without caller IDs', async () => {
        const { dispatcher, client } = make();
        await dispatcher.execute({ command: input.command, args: input.args, identity: 'user' }, grant);
        expect(client).toHaveBeenCalledWith({ profileId: 'p', accountId: 'a', identity: 'user' });
    });
    it('returns authorized choices for ambiguity and never replaces explicit unauthorized IDs', async () => {
        const { dispatcher, client } = make();
        const request = { command: input.command, args: input.args, identity: 'user' as const };
        const multiProfile = { ...grant, profiles: [...grant.profiles, { profileId: 'p2', accounts: ['b'], identities: ['user' as const] }] };
        await expect(dispatcher.execute(request, multiProfile)).rejects.toMatchObject({ code: 'SELECTION_REQUIRED', details: { profiles: expect.arrayContaining([expect.objectContaining({ profileId: 'p2' })]) } });
        await expect(dispatcher.execute(request, { ...grant, profiles: [{ ...grant.profiles[0]!, accounts: ['a', 'b'] }] })).rejects.toMatchObject({ code: 'SELECTION_REQUIRED' });
        await expect(dispatcher.execute({ ...request, profileId: 'outside' }, grant)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(dispatcher.execute({ ...request, accountId: 'outside' }, grant)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(client).not.toHaveBeenCalled();
    });
    it('rejects duplicate command registrations' , () => {
        const definition = { id: 'same', domain: 'x', description: 'x', inputSchema: {}, identities: ['user'] as const, scopes: [], risk: 'read' as const, source: 'api' as const };
        const command = { definition, execute: async () => ({}), preview: async () => ({}) };
        expect(() => new Registry([command, command])).toThrow();
    });
    it('normalizes domain aliases before strict validation and both execution modes', async () => {
        const execute = vi.fn(async () => 'executed'), preview = vi.fn(async () => 'preview');
        const normalize = vi.fn((args: Record<string, unknown>) => ({ limit: Number(args.LIMIT) }));
        const registry = new Registry([{ definition: { id: 'calendar.alias', domain: 'calendar', description: 'Fixture', inputSchema: { type: 'object', required: ['limit'], additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1 } } }, identities: ['user'], scopes: [], risk: 'read', source: 'shortcut' }, normalize, execute, preview }]);
        const client = vi.fn(async () => ({ request: vi.fn() }));
        const dispatcher = new Dispatcher(registry, fixtureValidator(), client, () => 1000);
        const request = { ...input, command: 'calendar.alias', args: { LIMIT: '3' } };
        await dispatcher.execute({ ...request, dryRun: true }, grant);
        expect(preview).toHaveBeenCalledWith({ limit: 3 }, expect.anything());
        expect(client).not.toHaveBeenCalled();
        await dispatcher.execute(request, grant);
        expect(execute).toHaveBeenCalledWith({ limit: 3 }, expect.anything());
        await expect(dispatcher.execute({ ...request, args: { LIMIT: 'bad' } }, grant)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });

    it('discovers mixed-risk commands but authorizes the validated operation before credentials', async () => {
        const execute = vi.fn(async () => 'ok'), preview = vi.fn(async () => 'plan');
        const registry = new Registry([{ definition: { id: 'calendar.raw', domain: 'calendar', description: 'Fixture', inputSchema: { type: 'object', required: ['method'], additionalProperties: false, properties: { method: { enum: ['GET', 'POST'] } } }, identities: ['user'], scopes: [], risk: 'write', source: 'service' }, risk: (args) => args.method === 'GET' ? 'read' : 'write', execute, preview }]);
        const client = vi.fn(async () => ({ request: vi.fn() }));
        const dispatcher = new Dispatcher(registry, fixtureValidator(), client, () => 1000);
        expect(dispatcher.search({ query: 'raw' }, grant).commands).toHaveLength(1);
        expect(dispatcher.schema('calendar.raw', grant)).toMatchObject({ riskByArguments: true });
        await dispatcher.execute({ ...input, command: 'calendar.raw', args: { method: 'GET' } }, grant);
        await expect(dispatcher.execute({ ...input, command: 'calendar.raw', args: { method: 'POST' }, dryRun: true }, grant)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(client).toHaveBeenCalledTimes(1);
        expect(preview).not.toHaveBeenCalled();
        await dispatcher.execute({ ...input, command: 'calendar.raw', args: { method: 'POST' } }, { ...grant, permissions: ['write'] });
        await expect(dispatcher.execute({ ...input, command: 'calendar.raw', args: { method: 'GET' } }, { ...grant, permissions: ['write'] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(client).toHaveBeenCalledTimes(2);
    });

});

import { describe, expect, it, vi } from 'vitest';
import { contactCapabilities } from '../src/capabilities/contact/commands';
import type { CommandContext } from '../src/ports/capabilities';

function fixture(identity: 'user' | 'bot', data: Record<string, unknown>) {
    const request = vi.fn(async () => data);
    const context: CommandContext = { lark: { request }, selection: { profileId: 'p', identity, ...(identity === 'user' ? { accountId: 'a' } : {}) },
        grant: { id: 'g', expiresAt: Date.now() + 60_000, revoked: false, domains: ['contact'], permissions: ['read'],
            profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user', 'bot'] }] } };
    return { command: contactCapabilities().find((item) => item.definition.id === 'contact.+get-user')!, request, context };
}
describe('contact user lookup', () => {
    it('gets the current user and previews without network access', async () => {
        const { command, request, context } = fixture('user', { open_id: 'ou_self', name: 'Self' });
        expect(await command.preview({}, context)).toEqual({ method: 'GET', path: '/open-apis/authen/v1/user_info' });
        expect(request).not.toHaveBeenCalled();
        expect(await command.execute({}, context)).toEqual({ user: { open_id: 'ou_self', name: 'Self' } });
        expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/open-apis/authen/v1/user_info' });
    });
    it('uses basic batch for a selected user and returns an empty object for a missing user', async () => {
        const { command, request, context } = fixture('user', { users: [{ user_id: 'fixture' }] });
        const args = { 'user-id': 'fixture', 'user-id-type': 'union_id' };
        const plan = { method: 'POST', path: '/open-apis/contact/v3/users/basic_batch', query: { user_id_type: 'union_id' }, body: { user_ids: ['fixture'] } };
        expect(await command.preview(args, context)).toEqual(plan);
        expect(await command.execute(args, context)).toEqual({ user: { user_id: 'fixture' } });
        expect(request).toHaveBeenCalledWith(plan);
        request.mockResolvedValueOnce({ users: [] });
        expect(await command.execute(args, context)).toEqual({ user: {} });
    });
    it('requires an explicit bot target before any request and escapes path segments', async () => {
        const { command, request, context } = fixture('bot', { user: { name: 'Target' } });
        await expect(command.preview({}, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(command.execute({}, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(request).not.toHaveBeenCalled();
        const args = { 'user-id': 'id/with?reserved' };
        const plan = { method: 'GET', path: '/open-apis/contact/v3/users/id%2Fwith%3Freserved', query: { user_id_type: 'open_id' } };
        expect(await command.preview(args, context)).toEqual(plan);
        expect(await command.execute(args, context)).toEqual({ user: { name: 'Target' } });
        expect(request).toHaveBeenCalledWith(plan);
    });
});

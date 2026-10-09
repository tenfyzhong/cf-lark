import { expect, it, vi } from 'vitest';
import { eventCapability } from '../src/capabilities/event/inbox';

it('reads only the execution profile and performs no inbox access on dry-run', async () => {
    const read = vi.fn(async () => ({ events: [], cursor: 12 }));
    const capability = eventCapability({ read });
    const args = { cursor: 10, limit: 2 };
    expect(await capability.preview(args)).toMatchObject({ cursor: 10, limit: 2 });
    expect(read).not.toHaveBeenCalled();
    expect(await capability.execute(args, { selection: { profileId: 'p', identity: 'bot' }, grant: { id: 'g', revoked: false, expiresAt: Date.now()+60000, profiles: [{ profileId: 'p', accounts: [], identities: ['bot'] }], domains: ['event'], permissions: ['read'] } } as never)).toEqual({ events: [], cursor: 12 });
    expect(read).toHaveBeenCalledWith('p', 10, 2);
    expect(capability.definition).toMatchObject({ id: 'event.inbox.read', domain: 'event', risk: 'read' });
});

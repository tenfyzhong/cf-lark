import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { SqliteCredentialStore } from '../src/infrastructure/storage/credential-store';

it('persists isolated credentials and cascades profile deletion across restarts', async () => {
    const database = new DatabaseSync(':memory:');
    const sql = { exec(query: string, ...bindings: (string | number | null)[]) {
        return database.prepare(query).all(...bindings) as Record<string, unknown>[];
    } };
    let store = new SqliteCredentialStore(sql);
    const profile = { id: 'p', name: 'Primary', brand: 'lark' as const, appId: 'app', secret: 'encrypted', generation: 1, createdAt: 1 };
    await store.putProfile(profile);
    await store.putProfile({ ...profile, id: 'other' });
    const account = { id: 'u', profileId: 'p', name: 'Owner', accessToken: 'ciphertext', refreshToken: 'ciphertext', expiresAt: 10, refreshExpiresAt: 20, scopes: [] };
    await store.putAccount(account);
    await store.putAccount({ ...account, profileId: 'other' });
    await store.putFlow({ id: 'f', profileId: 'p', generation: 1, deviceCode: 'encrypted', verificationUri: 'https://accounts.larksuite.com', expiresAt: 10, interval: 5, nextPollAt: 5, status: 'pending' });
    store = new SqliteCredentialStore(sql);
    expect(await store.getProfile('p')).toEqual(profile);
    expect(await store.getAccount('other', 'u')).toEqual({ ...account, profileId: 'other' });
    expect(await store.listAccounts('p')).toEqual([account]);
    await store.putProfile({ ...profile, name: 'Updated' });
    expect((await store.listProfiles()).find((item) => item.id === 'p')?.name).toBe('Updated');
    await store.deleteProfile('p');
    expect(await store.getProfile('p')).toBeUndefined();
    expect(await store.getFlow('f')).toBeUndefined();
    expect(await store.listAccounts('p')).toEqual([]);
    expect(await store.getAccount('other', 'u')).toBeDefined();
    await store.deleteAccount('other', 'u');
    expect(await store.getAccount('other', 'u')).toBeUndefined();
});

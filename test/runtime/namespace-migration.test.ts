import { env, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import type { Env } from '../../src/bootstrap/worker';
import { StorageMigration } from '../../src/infrastructure/storage/namespace-migration';

it('copies opaque records and sequence state, freezes writes, and rejects divergent retries', async () => {
    const namespace = (env as unknown as Env).AUTHORITY;
    const source = namespace.getByName('migration-source');
    const target = namespace.getByName('migration-target');
    const snapshot = await runInDurableObject(source, async (_instance, state) => {
        state.storage.sql.exec("INSERT INTO credential_profiles VALUES (?, ?)", 'profile', '{"encrypted":"opaque-ciphertext"}');
        state.storage.sql.exec("INSERT INTO oauth_records VALUES (?, ?, ?, ?)", 'session', 'opaque-session', 9999999999, null);
        const migration = new StorageMigration(state.storage);
        await migration.freeze();
        expect(() => migration.assertActive()).toThrow('maintenance');
        return migration.snapshot();
    });
    await runInDurableObject(target, async (_instance, state) => {
        const migration = new StorageMigration(state.storage);
        await migration.restore(snapshot);
        expect(await migration.snapshot()).toEqual(snapshot);
        await migration.restore(snapshot);
        state.storage.sql.exec("UPDATE credential_profiles SET value = ?", 'changed');
        await expect(migration.restore(snapshot)).rejects.toThrow('not empty');
    });
    await runInDurableObject(source, async (_instance, state) => {
        const migration = new StorageMigration(state.storage);
        migration.resume();
        expect(() => migration.assertActive()).not.toThrow();
    });
});

it('rejects tampered snapshots without changing destination data', async () => {
    const namespace = (env as unknown as Env).AUTHORITY;
    const source = await runInDurableObject(namespace.getByName('migration-checksum-source'), async (_instance, state) => new StorageMigration(state.storage).snapshot());
    source.digest = 'invalid';
    await runInDurableObject(namespace.getByName('migration-checksum-target'), async (_instance, state) => {
        const migration = new StorageMigration(state.storage);
        await expect(migration.restore(source)).rejects.toThrow('digest');
        expect(() => migration.assertActive()).not.toThrow();
    });
});

it('preserves event sequence high watermarks after deleted events', async () => {
    const namespace = (env as unknown as Env).EVENT_INBOX;
    const snapshot = await runInDurableObject(namespace.getByName('sequence-source'), async (_instance, state) => {
        state.storage.sql.exec("INSERT INTO event_inbox (sequence, profile, id, type, payload, bytes, expires) VALUES (42, 'p', 'event', 'message', '{}', 2, 9999999999)");
        state.storage.sql.exec("DELETE FROM event_inbox");
        return new StorageMigration(state.storage).snapshot();
    });
    await runInDurableObject(namespace.getByName('sequence-target'), async (_instance, state) => {
        const migration = new StorageMigration(state.storage);
        await migration.restore(snapshot);
        state.storage.sql.exec("INSERT INTO event_inbox (profile, id, type, payload, bytes, expires) VALUES ('p', 'next', 'message', '{}', 2, 9999999999)");
        expect([...state.storage.sql.exec('SELECT sequence FROM event_inbox')][0]?.sequence).toBe(43);
    });
});

it('rejects public requests to the migration control route', async () => {
    const { default: worker } = await import('../../src/bootstrap/worker');
    const response = await worker.fetch(new Request('https://service.example/api/internal/namespace-migration', { method: 'POST' }), env as unknown as Env);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found.');
});

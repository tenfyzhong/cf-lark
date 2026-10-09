import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteOAuthStore } from '../src/infrastructure/storage/oauth-store';
import { SerialExecutor } from '../src/infrastructure/concurrency/serial-executor';

function database() {
    const db = new DatabaseSync(':memory:');
    return { exec(query: string, ...bindings: (string | number | null)[]) {
        const stmt = db.prepare(query);
        return stmt.all(...bindings) as Record<string, unknown>[];
    } };
}

describe('OAuth SQLite storage contract', () => {
    it('preserves JSON, metadata, expiration, deletion, and stable pagination', async () => {
        let now = 100_000;
        const store = new SqliteOAuthStore(database(), () => now);
        await store.put('grant:a', JSON.stringify({ id: 'a' }), { expirationTtl: 60, metadata: { client: 'one' } });
        await store.put('grant:b', JSON.stringify({ id: 'b' }));
        await store.put('other:c', 'plain');
        expect(await store.get('grant:a', { type: 'json' })).toEqual({ id: 'a' });
        expect(await store.get('other:c')).toBe('plain');
        const page = await store.list({ prefix: 'grant:', limit: 1 });
        expect(page.keys).toEqual([{ name: 'grant:a', expiration: 160, metadata: { client: 'one' } }]);
        expect(page.list_complete).toBe(false);
        await store.delete('grant:a');
        expect((await store.list({ prefix: 'grant:', limit: 1, cursor: page.cursor })).keys[0]!.name).toBe('grant:b');
        await store.put('expiring', 'value', { expirationTtl: 1 });
        now += 1000;
        expect(await store.get('expiring')).toBeNull();
        expect((await store.list({ prefix: 'expiring' })).keys).toEqual([]);
    });
    it('treats prefix wildcard characters literally', async () => {
        const store = new SqliteOAuthStore(database());
        await store.put('x%:a', 'yes');
        await store.put('xyz:a', 'no');
        expect((await store.list({ prefix: 'x%:' })).keys.map((key) => key.name)).toEqual(['x%:a']);
    });
});

describe('OAuth transition serialization', () => {
    it('allows exactly one successful consumption even across awaits', async () => {
        const serial = new SerialExecutor();
        let available = true;
        const consume = () => serial.run(async () => {
            if (!available) return false;
            await Promise.resolve();
            available = false;
            return true;
        });
        expect(await Promise.all([consume(), consume(), consume()])).toEqual([true, false, false]);
    });
    it('releases the queue after a rejected operation', async () => {
        const serial = new SerialExecutor();
        await expect(serial.run(async () => { throw new Error('failure'); })).rejects.toThrow();
        expect(await serial.run(async () => 7)).toBe(7);
    });
});

it('atomically queues provider grant deletion and retries failed hooks without blocking revocation',async()=>{
    const db=database(),store=new SqliteOAuthStore(db);const calls:string[]=[];
    await store.put('grant:owner:provider',JSON.stringify({id:'provider',userId:'owner',metadata:{grantId:'service-owner'},encryptedProps:'private-token-data'}));
    store.setGrantRevocationHook(async owner=>{calls.push(owner);throw new Error('unavailable');});
    await expect(store.delete('grant:owner:provider')).resolves.toBeUndefined();expect(await store.get('grant:owner:provider')).toBeNull();
    expect(JSON.stringify(db.exec('SELECT * FROM oauth_grant_revocations'))).not.toContain('private-token-data');expect(calls).toEqual(['service-owner']);
    const reconstructed=new SqliteOAuthStore(db);reconstructed.setGrantRevocationHook(async owner=>{calls.push(owner);});expect(await reconstructed.drainGrantRevocations()).toEqual({delivered:1,failed:0});expect(calls).toEqual(['service-owner','service-owner']);expect(await reconstructed.drainGrantRevocations()).toEqual({delivered:0,failed:0});
});
it('queues expired grants but ignores access-token deletion and invalid provider shapes',async()=>{
    const db=database(),store=new SqliteOAuthStore(db,()=>2000);const calls:string[]=[];store.setGrantRevocationHook(async owner=>{calls.push(owner);});
    await store.put('token:owner:provider:token','not-json');await store.delete('token:owner:provider:token');
    await store.put('grant:owner:mismatch',JSON.stringify({id:'different',userId:'owner',metadata:{grantId:'wrong'}}));await store.delete('grant:owner:mismatch');
    await store.put('grant:owner:invalid','not-json');await store.delete('grant:owner:invalid');
    await store.put('grant:owner:expired',JSON.stringify({id:'expired',userId:'owner',metadata:{grantId:'service-owner'}}),{expiration:1});store.purgeExpired();expect(await store.drainGrantRevocations()).toEqual({delivered:1,failed:0});expect(calls).toEqual(['service-owner']);
});

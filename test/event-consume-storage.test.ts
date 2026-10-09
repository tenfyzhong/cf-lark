import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { SqliteEventConsumerStore } from '../src/infrastructure/storage/event-consumers';
import { SecretBox } from '../src/infrastructure/crypto/secret-box';
import type { EventConsumer } from '../src/ports/event-consumers';
function setup() { const db = new DatabaseSync(':memory:'); const sql = { exec(query: string, ...args: (string | number | null)[]) { return db.prepare(query).all(...args) as Record<string, unknown>[]; } }; return { sql, store: new SqliteEventConsumerStore(sql, new SecretBox(btoa(String.fromCharCode(...new Uint8Array(32))))) }; }
it('encrypts consumer state and uses owner-scoped revision claims', async () => {
    const { sql, store } = setup(); const record: EventConsumer = { id: 'one', owner: 'g', selection: { profileId: 'p', identity: 'bot' }, key: 'card.action.trigger', params: {}, group: 'group', cursor: 0, emitted: 0, maxEvents: 1, expiresAt: 1000, revision: 0, status: 'starting', setupIndex: 0, leader: true, pending: { private: 'secret-card' } };
    await store.create(record); expect(JSON.stringify(sql.exec('SELECT * FROM event_consumers'))).not.toContain('secret-card'); expect(await store.get('other','one')).toBeUndefined();
    expect((await Promise.all([store.transition({ ...record, revision: 1, status: 'active' },0),store.transition({ ...record, revision: 1, status: 'active' },0)])).sort()).toEqual([false,true]); expect(await store.expired(1000,10)).toHaveLength(1);
});
it('reference counts shared subscriptions and isolates transition and singleton locks', async () => {
    const { store } = setup(); expect(await store.join('shared','a',false)).toEqual({ leader:true }); await expect(store.join('shared','b',false)).rejects.toMatchObject({ code:'SUBSCRIPTION_BUSY' });
    await store.activate('shared','a'); expect(await store.join('shared','b',false)).toEqual({ leader:false }); expect(await store.leave('shared','a')).toBe(false); expect(await store.leave('shared','b')).toBe(true); await expect(store.join('shared','c',false)).rejects.toMatchObject({ code:'SUBSCRIPTION_BUSY' }); await store.removeGroup('shared'); expect(await store.join('shared','c',true)).toEqual({ leader:true }); await store.activate('shared','c'); await expect(store.join('shared','d',true)).rejects.toMatchObject({ code:'SINGLE_CONSUMER' });
});
it('prunes stopped consumers after retention while preserving active and uncertain records',async()=>{
    const {store}=setup();const record:EventConsumer={id:'old',owner:'g',selection:{profileId:'p',identity:'bot'},key:'im.chat.updated_v1',params:{},group:'group',cursor:0,emitted:0,maxEvents:0,expiresAt:1000,revision:0,status:'stopped',setupIndex:0,leader:true};
    await store.create(record);await store.create({...record,id:'active',status:'active'});await store.create({...record,id:'uncertain',status:'uncertain'});
    expect(await store.prune(1000)).toBe(1);expect(await store.get('g','old')).toBeUndefined();expect(await store.get('g','uncertain')).toBeDefined();
});
it('bounds active consumers per owner',async()=>{
    const {store}=setup();const record:EventConsumer={id:'one',owner:'g',selection:{profileId:'p',identity:'bot'},key:'im.chat.updated_v1',params:{},group:'group',cursor:0,emitted:0,maxEvents:0,expiresAt:1000,revision:0,status:'active',setupIndex:0,leader:true};
    for(let i=0;i<100;i++)await store.create({...record,id:String(i)});
    await expect(store.create(record)).rejects.toMatchObject({code:'EVENT_CAPACITY'});
});
it('enforces encrypted aggregate capacity when an existing consumer grows',async()=>{
    const {sql}=setup();const store=new SqliteEventConsumerStore(sql,new SecretBox(btoa(String.fromCharCode(...new Uint8Array(32)))),{maxActivePerOwner:100,maxRecords:1000,maxBytes:2000});
    const record:EventConsumer={id:'growing',owner:'g',selection:{profileId:'p',identity:'bot'},key:'im.chat.updated_v1',params:{},group:'group',cursor:0,emitted:0,maxEvents:0,expiresAt:1000,revision:0,status:'active',setupIndex:0,leader:true};
    await store.create(record);await expect(store.transition({...record,revision:1,pending:{content:'x'.repeat(2000)}},0)).rejects.toMatchObject({code:'EVENT_CAPACITY'});expect((await store.get('g','growing'))?.revision).toBe(0);
});
it('does not let frozen in-flight records starve actionable expired consumers',async()=>{
    const {store}=setup();const record:EventConsumer={id:'one',owner:'g',selection:{profileId:'p',identity:'bot'},key:'im.chat.updated_v1',params:{},group:'group',cursor:0,emitted:0,maxEvents:0,expiresAt:0,revision:0,status:'polling',setupIndex:0,leader:true};
    for(let i=0;i<25;i++)await store.create({...record,id:String(i)});await store.create({...record,id:'eligible',status:'active',expiresAt:1});expect((await store.expired(2,25)).map(row=>row.id)).toEqual(['eligible']);
});

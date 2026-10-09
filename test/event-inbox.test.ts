import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { SqliteEventInbox } from '../src/infrastructure/storage/event-inbox';

it('deduplicates per profile, isolates cursor reads, expires events and bounds storage', async () => {
    const db = new DatabaseSync(':memory:');
    const sql = { exec(query: string, ...bindings: (string | number | null)[]) { return db.prepare(query).all(...bindings) as Record<string, unknown>[]; } };
    let now = 1000;
    const inbox = new SqliteEventInbox(sql, () => now, { maxEvents: 2, maxBytes: 1000 });
    const event = { id: 'e1', type: 'im.message.receive_v1', payload: { message: 'Example' } };
    expect(await inbox.append('p', event)).toBe(true);
    expect(await inbox.append('p', event)).toBe(false);
    expect(await inbox.append('other', event)).toBe(true);
    await inbox.append('p', { ...event, id: 'e2' });
    await expect(inbox.append('p', { ...event, id: 'e3' })).rejects.toMatchObject({ code: 'EVENT_CAPACITY' });
    const first = await inbox.read('p', 0, 1);
    expect(first.events).toHaveLength(1);
    expect(first.events[0]).toMatchObject(event);
    expect((await inbox.read('p', first.cursor, 100)).events.map((item) => item.id)).toEqual(['e2']);
    expect((await inbox.read('other', 0, 100)).events.map((item) => item.id)).toEqual(['e1']);
    await inbox.putSettings('p', 'encrypted-settings');
    expect(await inbox.getSettings('p')).toBe('encrypted-settings');
    now += 86400_000;
    expect((await inbox.read('p', 0, 100)).events).toEqual([]);
    await inbox.cleanup();
    expect(await inbox.append('p', { ...event, id: 'e3' })).toBe(true);
    await inbox.removeProfile('p');
    expect(await inbox.getSettings('p')).toBeUndefined();
    expect((await inbox.read('p', 0, 100)).events).toEqual([]);
});

it('omits verification tokens on writes and historical reads while preserving event data', async () => {
    const db = new DatabaseSync(':memory:');
    const sql = { exec(query: string, ...bindings: (string | number | null)[]) { return db.prepare(query).all(...bindings) as Record<string, unknown>[]; } };
    const inbox = new SqliteEventInbox(sql, () => 1000);
    const payload = { token: 'secret-root', header: { token: 'secret-header', event_id: 'e' }, event: { document_token: 'business-token' } };
    await inbox.append('p', { id: 'new', type: 'example', payload });
    expect(JSON.stringify(sql.exec('SELECT payload FROM event_inbox'))).not.toContain('secret-');
    sql.exec('INSERT INTO event_inbox(profile,id,type,payload,bytes,expires) VALUES (?,?,?,?,?,?)', 'p', 'old', 'example', JSON.stringify(payload), 100, 2000);
    const result = await inbox.read('p', 0, 100);
    expect(JSON.stringify(result)).not.toContain('secret-');
    expect(result.events[1]?.payload.event).toEqual({ document_token: 'business-token' });
});
it('returns a profile-scoped tail without exposing retained payloads', async () => {
    const db = new DatabaseSync(':memory:');
    const sql = { exec(query: string, ...bindings: (string | number | null)[]) { return db.prepare(query).all(...bindings) as Record<string, unknown>[]; } };
    const inbox = new SqliteEventInbox(sql);
    expect(await inbox.tail('p')).toBe(0);
    await inbox.append('p',{id:'one',type:'example',payload:{}});
    await inbox.append('other',{id:'two',type:'example',payload:{}});
    expect(await inbox.tail('p')).toBe(1);
    expect(await inbox.tail('other')).toBe(2);
});
it('reports callback readiness without returning encrypted settings', async () => {
    const { EventService } = await import('../src/application/events');
    const db=new DatabaseSync(':memory:');const sql={exec(query:string,...bindings:(string|number|null)[]){return db.prepare(query).all(...bindings) as Record<string,unknown>[];}};
    const inbox=new SqliteEventInbox(sql),service=new EventService(inbox,{} as never,async()=>({challenge:'challenge'}));
    expect(await service.configured('p')).toBe(false);await inbox.putSettings('p','encrypted');expect(await service.configured('p')).toBe(true);
});

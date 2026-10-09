import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { EventConsumeService } from '../src/capabilities/event/lifecycle';
import { SqliteEventConsumerStore } from '../src/infrastructure/storage/event-consumers';
import { SecretBox } from '../src/infrastructure/crypto/secret-box';
import type { CommandContext } from '../src/ports/capabilities';
import type { ApiRequest } from '../src/ports/lark';
import type { InboxEvent } from '../src/ports/events';
import type { EventQuery } from '../src/ports/event-consumers';
import type { ArtifactStore } from '../src/ports/artifacts';
function setup(events: (InboxEvent & {sequence:number})[] = [], user = false, appAccess = true, query?: EventQuery) {
    const db = new DatabaseSync(':memory:'), sql = {exec(query:string,...args:(string|number|null)[]) {return db.prepare(query).all(...args) as Record<string,unknown>[];}}, store = new SqliteEventConsumerStore(sql,new SecretBox(btoa(String.fromCharCode(...new Uint8Array(32)))));
    const request = vi.fn(async (_r:ApiRequest) => ({open_id:'ou_me'}));
    const context: CommandContext = {lark:{request},selection:{profileId:'p',identity:user?'user':'bot',...(user?{accountId:'a'}:{})},grant:{id:'g',revoked:false,expiresAt:Date.now()+60000,profiles:[{profileId:'p',accounts:['a'],identities:appAccess?['user','bot']:['user']}],domains:['event','vc','im','minutes','artifact'],permissions:['read','write']}};
    const inbox = {read:vi.fn(async (_profile:string,cursor:number) => {const rows=events.filter(e=>e.sequence>cursor);return {events:rows,cursor:rows.at(-1)?.sequence??cursor};}),tail:vi.fn(async()=>0),getSettings:vi.fn(async()=> 'configured')};
    const service = new EventConsumeService(store,inbox,{upload:vi.fn()} as unknown as ArtifactStore,query);
    return {service,request,context,store,inbox};
}
it('shares an upstream user subscription and cleans up only after the last consumer', async () => {
    const {service,request,context} = setup([],true);
    const a = await service.start({'event-key':'vc.meeting.participant_meeting_started_v1'},context); for(let i=0;i<3;i++) await service.poll(a.consumerId,context);
    const b = await service.start({'event-key':'vc.meeting.participant_meeting_started_v1'},context); await service.poll(b.consumerId,context);
    expect(request.mock.calls.filter(([r])=>r.path.endsWith('/subscription'))).toHaveLength(1);
    await service.stop(a.consumerId,context); expect(request.mock.calls.filter(([r])=>r.path.endsWith('/unsubscription'))).toHaveLength(0);
    await service.stop(b.consumerId,context); expect(request.mock.calls.filter(([r])=>r.path.endsWith('/unsubscription'))).toHaveLength(1);
});
it('advances durable cursors and stops at the successful emission count', async () => {
    const {service,context} = setup([{id:'e',type:'im.chat.updated_v1',sequence:1,payload:{event:{chat_id:'oc_a'}}}]);
    const created = await service.start({'event-key':'im.chat.updated_v1','max-events':1},context); let result;
    for(let i=0;i<4;i++){result=await service.poll(created.consumerId,context);if(result.events.length) break;}
    expect(result).toMatchObject({cursor:1,emitted:1,events:[{event:{chat_id:'oc_a'}}]});
    await service.poll(created.consumerId,context); expect(await service.status(created.consumerId,context)).toMatchObject({status:'stopped'});
});
it('drops user events without provable recipient for an account-only grant', async () => {
    const {service,context} = setup([{id:'e',type:'vc.meeting.participant_meeting_started_v1',sequence:1,payload:{event:{meeting:{id:'m'}}}}],true,false);
    const created = await service.start({'event-key':'vc.meeting.participant_meeting_started_v1'},context); let result;
    for(let i=0;i<5;i++) result=await service.poll(created.consumerId,context);
    expect(result?.events).toEqual([]); expect((await service.status(created.consumerId,context)).cursor).toBe(1);
});
it('rejects cross-owner access and freezes unknown setup outcomes', async () => {
    const {service,context,request} = setup([],true); const created=await service.start({'event-key':'vc.note.generated_v1'},context); request.mockImplementation(async()=>{throw new Error('network disconnected');});
    await expect(service.poll(created.consumerId,context)).rejects.toMatchObject({code:'OUTCOME_UNCERTAIN'});
    await expect(service.poll(created.consumerId,context)).rejects.toMatchObject({code:'OUTCOME_UNCERTAIN'});
    await expect(service.status(created.consumerId,{...context,grant:{...context.grant,id:'other'}})).rejects.toMatchObject({code:'CONSUMER_NOT_FOUND'});
});
it('does not treat undocumented business fields as proof of a user recipient', async () => {
    const {service,context} = setup([{id:'e',type:'vc.meeting.participant_meeting_started_v1',sequence:1,payload:{event:{recipient_id:'ou_me',meeting:{id:'private'}}}}],true,false);
    const created=await service.start({'event-key':'vc.meeting.participant_meeting_started_v1'},context);let emitted=0;for(let i=0;i<6;i++)emitted+=(await service.poll(created.consumerId,context)).events.length;
    expect(emitted).toBe(0);
});
it('emits the first jq result including null and ignores later results', async () => {
    const query={process:vi.fn(async (args:{operation:string})=>args.operation==='jq-validate'?true:[null,'ignored'])};
    const {service,context}=setup([{id:'e',type:'im.chat.updated_v1',sequence:1,payload:{event:{chat_id:'oc_a'}}}],false,true,query);
    const created=await service.start({'event-key':'im.chat.updated_v1',jq:'null, "ignored"'},context);await service.poll(created.consumerId,context);expect((await service.poll(created.consumerId,context)).events).toEqual([null]);
});
it('retains failed cleanup intent so a definite unsubscribe rejection can be retried', async () => {
    const {service,context,request}=setup([],true);const created=await service.start({'event-key':'vc.note.generated_v1'},context);for(let i=0;i<3;i++)await service.poll(created.consumerId,context);
    const { ServiceError }=await import('../src/domain/errors');let attempts=0;request.mockImplementation(async r=>{if(r.path.endsWith('/unsubscription')&&++attempts===1)throw new ServiceError('UPSTREAM_ERROR','Rejected',502,{upstreamCode:99991400});return {open_id:'ou_me'};});
    await expect(service.stop(created.consumerId,context)).rejects.toMatchObject({code:'UPSTREAM_ERROR'});await service.stop(created.consumerId,context);expect(attempts).toBe(2);
});
it('honors quiet diagnostics and scheduled timeout cleanup',async()=>{
    const {service,context,store}=setup([{id:'e',type:'vc.note.generated_v1',sequence:1,payload:{event:{note_id:'private'}}}],true,false);
    const created=await service.start({'event-key':'vc.note.generated_v1',quiet:true},context);for(let i=0;i<5;i++)expect(await service.poll(created.consumerId,context)).not.toHaveProperty('diagnostics');
    const record=(await store.get('g',created.consumerId))!;await store.transition({...record,revision:record.revision+1,expiresAt:0},record.revision);expect(await service.cleanup(async()=>context.lark)).toEqual({stopped:1,failed:0});
});
it('matches selection by values independent of object key ordering',async()=>{
    const {service,context}=setup([],true);const created=await service.start({'event-key':'vc.note.generated_v1'},context);
    const reordered={...context,selection:{accountId:'a',identity:'user' as const,profileId:'p'}};
    expect(await service.status(created.consumerId,reordered)).toMatchObject({consumerId:created.consumerId});
});
it('rechecks recipient access for persisted enrichment after grant narrowing',async()=>{
    const {service,context,store,request}=setup([],true);const created=await service.start({'event-key':'vc.note.generated_v1'},context);for(let i=0;i<3;i++)await service.poll(created.consumerId,context);
    const record=(await store.get('g',created.consumerId))!;await store.transition({...record,revision:record.revision+1,pending:{event:{id:'private-id',type:'vc.note.generated_v1',sequence:1,payload:{event:{note_id:'secret'}}},process:{}}},record.revision);
    const narrowed={...context,grant:{...context.grant,profiles:[{profileId:'p',accounts:['a'],identities:['user' as const]}]}};request.mockClear();
    const result=await service.poll(created.consumerId,narrowed);expect(result.events).toEqual([]);expect(JSON.stringify(result)).not.toContain('private-id');expect(request).not.toHaveBeenCalled();
});
it('does not disclose event identifiers in rejected app payload diagnostics',async()=>{
    const {service,context}=setup([{id:'private-id',type:'vc.note.generated_v1',sequence:1,payload:{event:{note_id:'secret'}}}],true,false);const created=await service.start({'event-key':'vc.note.generated_v1'},context);for(let i=0;i<4;i++)expect(JSON.stringify(await service.poll(created.consumerId,context))).not.toContain('private-id');
});
it('revokes an owner durably, blocks stale contexts, and retries definite cleanup failure',async()=>{
    const {service,context,store,request}=setup([],true);const created=await service.start({'event-key':'vc.note.generated_v1'},context);for(let i=0;i<3;i++)await service.poll(created.consumerId,context);
    const {ServiceError}=await import('../src/domain/errors');let attempts=0;request.mockImplementation(async r=>{if(r.path.endsWith('/unsubscription')&&++attempts===1)throw new ServiceError('UPSTREAM_ERROR','Rejected');return {open_id:'ou_me'};});
    expect(await service.revokeOwner('g',async()=>context.lark)).toEqual({stopped:0,failed:1});
    await expect(service.poll(created.consumerId,context)).rejects.toMatchObject({code:'GRANT_REVOKED'});await expect(service.start({'event-key':'vc.note.generated_v1'},context)).rejects.toMatchObject({code:'GRANT_REVOKED'});
    expect(await service.cleanup(async()=>context.lark)).toEqual({stopped:1,failed:0});expect(attempts).toBe(2);expect((await store.get('g',created.consumerId))?.status).toBe('stopped');
});
it('bounds immediate owner cleanup while retaining every remaining revocation intent',async()=>{
    const {service,context,store}=setup();for(let i=0;i<11;i++)await service.start({'event-key':'im.chat.updated_v1'},context).then(async result=>{await service.poll(result.consumerId,context);});
    expect(await service.revokeOwner('g',async()=>context.lark)).toEqual({stopped:10,failed:0});expect(await store.expired(0,25)).toHaveLength(1);expect(await service.cleanup(async()=>context.lark)).toEqual({stopped:1,failed:0});
});

import { expect, it, vi } from 'vitest';
import { processEventKey } from '../src/capabilities/event/processors';
import type { CommandContext } from '../src/ports/capabilities';
const context = (request = vi.fn(async () => ({}))) => ({ lark: { request } } as unknown as CommandContext);
it('projects meeting lifecycle and recording bean transcripts with UTC timestamps', async () => {
    expect(await processEventKey({ id:'e',type:'vc.meeting.participant_meeting_ended_v1',payload:{header:{create_time:'1000'},event:{meeting:{id:'m',start_time:'1790812800',end_time:'1790816400'}}}}, context())).toMatchObject({ done:true, output:{type:'vc.meeting.participant_meeting_ended_v1',meeting_id:'m',end_time:'2026-10-01T01:00:00Z'} });
    expect(await processEventKey({ id:'e',type:'vc.recording.recording_started_v1',payload:{event:{source:'other'}}},context())).toEqual({done:true,output:null});
    expect(await processEventKey({ id:'e',type:'vc.recording.recording_transcript_generated_v1',payload:{header:{create_time:'1790812800000'},event:{source:'recording_bean',transcript_items:[{speaker:{user_name:'Sam'},text:'Hello',start_time_ms:1790812800000}]}}},context())).toMatchObject({done:true,output:{transcript_items:[{speaker_name:'Sam',start_time:'2026-10-01T00:00:00Z'}]}});
});
it('keeps native event envelopes while removing callback verification secrets', async () => {
    const result = await processEventKey({id:'e',type:'im.chat.updated_v1',payload:{schema:'2.0',header:{token:'secret'},event:{chat_id:'oc_a',name:'New'}}},context());
    expect(result).toEqual({done:true,output:{schema:'2.0',header:{},event:{chat_id:'oc_a',name:'New'}}});
});
it('checkpoints minute enrichment retries and preserves card action business tokens', async () => {
    const request = vi.fn(async () => ({minute:{}}));
    expect(await processEventKey({id:'e',type:'minutes.minute.generated_v1',payload:{event:{minute_token:'min'}}},context(request))).toMatchObject({done:false,state:{attempt:1}});
    const card = await processEventKey({id:'e',type:'card.action.trigger',payload:{header:{token:'verification'},event:{token:'business-update',action:{checked:false,value:{a:1}},context:{open_message_id:'om_a'}}}},context(vi.fn(async () => ({items:[{body:{content:'card DSL'}}]}))));
    expect(card).toMatchObject({done:true,output:{token:'business-update',checked:false,action_value:'{"a":1}',card_content:'card DSL'}});
});
it('projects menu, approval and message events and uses the exact interactive formatter', async()=>{
    expect(await processEventKey({id:'e',type:'application.bot.menu_v6',payload:{header:{app_id:'app'},event:{timestamp:1790812800,event_key:'menu',operator:{operator_id:{open_id:'ou_a'},operator_name:'Sam'}}}},context())).toMatchObject({output:{menu_timestamp:'1790812800000',timestamp:'1790812800000',operator_open_id:'ou_a'}});
    expect(await processEventKey({id:'e',type:'approval.task.status_changed_v4',payload:{event:{task_id:'task',status:'APPROVED',assigned_user:{open_id:'ou_a',extra:'not-in-contract'},ignored:'private'}}},context())).toEqual({done:true,output:{type:'approval.task.status_changed_v4',event_id:'e',task_id:'task',status:'APPROVED',assigned_user:{open_id:'ou_a'}}});
    const formatter={formatEvent:vi.fn(async()=>'<card>Rendered</card>')};
    expect(await processEventKey({id:'e',type:'im.message.receive_v1',payload:{event:{sender:{sender_id:{open_id:'ou_a'}},message:{message_id:'om_a',message_type:'interactive',content:'raw',create_time:'1000',update_time:'1000',mentions:[{key:'@_1',id:{open_id:'ou_b'},name:'Pat'}]}}}},context(),{},formatter)).toMatchObject({output:{id:'om_a',message_id:'om_a',timestamp:'1000',content:'<card>Rendered</card>',mentions:[{id:'ou_b'}]}});
    expect(formatter.formatEvent).toHaveBeenCalledWith('raw',[{key:'@_1',id:{open_id:'ou_b'},name:'Pat'}]);
});
it('rejects malformed typed custom fields instead of violating output schemas',async()=>{
    await expect(processEventKey({id:'e',type:'vc.meeting.participant_meeting_started_v1',payload:{event:{meeting:{id:123}}}},context())).rejects.toMatchObject({code:'MALFORMED_EVENT'});
});

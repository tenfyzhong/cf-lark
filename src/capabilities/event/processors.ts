import { eventKey } from './keys';
import { publicEventPayload } from '../../domain/event-payload';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { CommandContext } from '../../ports/capabilities';
import type { InboxEvent } from '../../ports/events';
import type { EventCardFormatter } from '../../ports/event-consumers';
import { formatEventMessage } from '../im/index';
const obj = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const clean = (value: JsonObject): JsonObject => Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined && v !== null && v !== '' && (!Array.isArray(v) || v.length)));
function instant(value: unknown, divisor = 1): string { const raw = String(value ?? ''); if (!/^-?\d+$/.test(raw)) return ''; const date = new Date(Number(raw) * 1000 / divisor); return Number.isFinite(date.getTime()) ? date.toISOString().replace(/\.000Z$/, 'Z') : ''; }
export type EventProcessResult = { done: true; output: JsonObject | null } | { done: false; state: JsonObject };
export async function processEventKey(raw: InboxEvent, context: CommandContext, state: JsonObject = {}, card?: EventCardFormatter): Promise<EventProcessResult> {
    const payload = publicEventPayload(raw.payload), header = obj(payload.header), event = obj(payload.event), type = raw.type, base = clean({type,event_id:raw.id || header.event_id,timestamp:header.create_time}), done = (output: JsonObject | null): EventProcessResult => { const projected=output && clean(output); const definition=eventKey(type); if(projected && definition.schema.custom) validateTypes(projected,definition.resolved_output_schema); return {done:true,output:projected}; };
    if (!payload.event || typeof payload.event !== 'object' || Array.isArray(payload.event)) throw new ServiceError('MALFORMED_EVENT','Event payload must contain an event object.');
    if (type.startsWith('vc.meeting.participant_meeting_')) { const meeting = obj(event.meeting); return done({...base,meeting_id:meeting.id,topic:meeting.topic,meeting_no:meeting.meeting_no,start_time:instant(meeting.start_time),...(type.includes('_ended_') ? {end_time:instant(meeting.end_time)} : {}),calendar_event_id:meeting.calendar_event_id}); }
    if (type.startsWith('vc.recording.')) { if (event.source !== 'recording_bean') return done(null); const output: JsonObject = {type,event_id:raw.id,event_time:instant(header.create_time,1000),source:event.source,unique_key:event.unique_key}; if (type.includes('transcript_generated')) output.transcript_items = arr(event.transcript_items).map(obj).map(item => clean({speaker_name:obj(item.speaker).user_name,text:item.text,start_time:instant(item.start_time_ms,1000),end_time:instant(item.end_time_ms,1000),sentence_id:item.sentence_id})); return done(output); }
    if (type === 'application.bot.menu_v6') { const operator = obj(event.operator), ids = obj(operator.operator_id), rawTimestamp = String(event.timestamp ?? ''), timestamp = /^\d{10}$/.test(rawTimestamp) ? rawTimestamp+'000' : rawTimestamp; return done({...base,timestamp:header.create_time || timestamp,app_id:header.app_id,tenant_key:header.tenant_key,event_key:event.event_key,menu_timestamp:timestamp,operator_id:ids.open_id,operator_open_id:ids.open_id,operator_union_id:ids.union_id,operator_user_id:ids.user_id,operator_name:operator.operator_name}); }
    if (type.startsWith('approval.')) { const userKey = type.includes('.instance.') ? 'start_user' : 'assigned_user'; if (event[userKey] && typeof event[userKey] === 'object') { const user = obj(event[userKey]); event[userKey] = clean({open_id:user.open_id,union_id:user.union_id,user_id:user.user_id}); } const fields = type.includes('.instance.') ? ['approval_code','instance_code','external_id','status','operate_time','start_user'] : ['approval_code','instance_code','task_id','external_id','task_external_id','assigned_user','status','operate_time']; return done({...base,...Object.fromEntries(fields.map(key => [key,event[key]]))}); }
    if (type === 'im.message.receive_v1') {
        const message = obj(event.message), sender = obj(event.sender), mentions = arr(message.mentions).map(obj).map(item => clean({key:item.key,id:typeof item.id === 'string' ? item.id : obj(item.id).open_id,name:item.name})).filter(item => Object.keys(item).length);
        const content = message.message_type === 'interactive' && card ? await card.formatEvent(String(message.content ?? ''),arr(message.mentions)) : formatEventMessage(message);
        return done({...base,timestamp:header.create_time || message.create_time,id:message.message_id,message_id:message.message_id,create_time:message.create_time,...(message.update_time && message.update_time !== message.create_time ? {update_time:message.update_time} : {}),chat_id:message.chat_id,chat_type:message.chat_type,message_type:message.message_type,sender_id:obj(sender.sender_id).open_id,sender_type:sender.sender_type,root_id:message.root_id,thread_id:message.thread_id,reply_to:message.parent_id,content,mentions});
    }
    if (type === 'card.action.trigger') {
        const action = obj(event.action), envelopeContext = obj(event.context), stringify = (value: unknown) => Object.keys(obj(value)).length ? JSON.stringify(value) : '';
        const output: JsonObject = {...base,operator_id:obj(event.operator).open_id,message_id:envelopeContext.open_message_id,chat_id:envelopeContext.open_chat_id,host:event.host,token:event.token,action_tag:action.tag,action_value:stringify(action.value),action_name:action.name,form_value:stringify(action.form_value),input_value:action.input_value,option:action.option,options:arr(action.options).join(','),checked:action.checked === true,timezone:action.timezone};
        if (output.message_id) { try { const data = await context.lark.request({method:'GET',path:`/open-apis/im/v1/messages/${encodeURIComponent(String(output.message_id))}`,query:{card_msg_content_type:'user_card_content'}}); output.card_content = obj(obj(arr(data.items)[0]).body).content; } catch { /* Card fetch is best effort in the upstream processor. */ } }
        return done(output);
    }
    if (type === 'minutes.minute.generated_v1' || type === 'vc.note.generated_v1') {
        const minute = type.startsWith('minutes.'), identifier = String(event[minute ? 'minute_token' : 'note_id'] ?? ''), output: JsonObject = {...base,[minute ? 'minute_token' : 'note_id']:identifier}; if (minute && Object.keys(obj(event.minute_source)).length) output.minute_source = clean({source_type:obj(event.minute_source).source_type,source_entity_id:obj(event.minute_source).source_entity_id}); if (!identifier) return done(output);
        const attempt = Number(state.attempt ?? 0); if (Number(state.nextAt ?? 0) > Date.now()) return {done:false,state}; let retry = false;
        try { const data = await context.lark.request({method:'GET',path:`/open-apis/${minute ? 'minutes/v1/minutes' : 'vc/v1/notes'}/${encodeURIComponent(identifier)}`}); if (minute) { const title = obj(data.minute).title; if (title) output.title = title; else retry = true; } else { const note = obj(data.note); for (const artifact of arr(note.artifacts).map(obj)) { const field = artifact.artifact_type === 1 ? 'note_token' : artifact.artifact_type === 2 ? 'verbatim_token' : ''; if (field && !output[field] && artifact.doc_token) output[field] = artifact.doc_token; } if (!output.note_token && !output.verbatim_token) retry = true; else if (Object.keys(obj(note.note_source)).length) output.note_source = clean({source_type:obj(note.note_source).source_type,source_entity_id:obj(note.note_source).source_entity_id}); } }
        catch (error) { retry = minute || error instanceof ServiceError && Number(error.details?.upstreamCode) === 121004; }
        if (retry && attempt < 2) return {done:false,state:{attempt:attempt+1,nextAt:Date.now()+500}}; return done(output);
    }
    return done(payload);
}

function validateTypes(value: unknown, schema: JsonObject): void {
    const type=schema.type;
    if(type==='object'){if(!value||typeof value!=='object'||Array.isArray(value))throw new ServiceError('MALFORMED_EVENT','Event field has an invalid object value.');for(const [key,child] of Object.entries(obj(schema.properties)))if(key in (value as JsonObject))validateTypes((value as JsonObject)[key],obj(child));}
    else if(type==='array'){if(!Array.isArray(value))throw new ServiceError('MALFORMED_EVENT','Event field has an invalid array value.');for(const item of value)validateTypes(item,obj(schema.items));}
    else if(type==='string'&&typeof value!=='string'||type==='boolean'&&typeof value!=='boolean'||(type==='number'||type==='integer')&&typeof value!=='number')throw new ServiceError('MALFORMED_EVENT','Event field has an invalid scalar value.');
}

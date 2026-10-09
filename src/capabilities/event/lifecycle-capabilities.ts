import { ServiceError } from '../../domain/errors';
import type { Capability } from '../../ports/capabilities';
import { eventKey, eventKeys, eventParameters, eventSetup } from './keys';
import { eventConsumerDefinitions } from './lifecycle-definitions';
import type { EventConsumeService } from './lifecycle';
export function eventConsumerCapabilities(service?:Pick<EventConsumeService,'start'|'poll'|'stop'|'status'|'list'>):Capability[]{return eventConsumerDefinitions.map(definition=>({definition,preview:async args=>{
    if(definition.id==='event.consume'&&!args.consumerId){const key=String(args['event-key']??''),params=eventParameters(key,args.param??args.params);return {event_key:key,params,identity_options:eventKey(key).auth_types,required_scopes:eventKey(key).scopes??[],requests:eventSetup(key,params).start,callback_required:true,side_effects:['durable consumer','shared upstream subscription where applicable'],output_mode:'durable polling',account_recipient_limitation:'Pinned user envelopes do not prove recipient account; profile event visibility requires an explicit bot/app event grant.'};}return {operation:definition.id,...args};
},execute:async(args,context)=>{
    if(!['event.list','event.schema'].includes(definition.id)&&!(definition.id==='event.consume'&&args['dry-run']===true)&&!service)throw new ServiceError('UNAVAILABLE','Event consumer storage is unavailable.',503);
    switch(definition.id){case 'event.list':{const domain=String(args.domain??'').trim();if(domain&&!eventKeys.some(key=>key.key.startsWith(domain+'.')))throw new ServiceError('INVALID_ARGUMENTS','Unknown event domain.');return eventKeys.filter(key=>!domain||key.key.startsWith(domain+'.'));}
    case 'event.schema':return eventKey(String(args['event-key']??''));
    case 'event.consume':if(args['dry-run']===true)return eventConsumerCapabilities(service).find(c=>c.definition.id==='event.consume')!.preview(args,context);return args.consumerId?service!.poll(String(args.consumerId),context):service!.start(args,context);
    case 'event.stop':return service!.stop(String(args.consumerId),context);
    case 'event.status':return args.consumerId?service!.status(String(args.consumerId),context):service!.list(context);
    default:throw new ServiceError('UNKNOWN_COMMAND','Unknown event lifecycle operation.');}
}}));}

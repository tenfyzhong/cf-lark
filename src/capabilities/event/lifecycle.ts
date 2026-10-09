import { authorize } from '../../domain/authorization';
import { ServiceError, safeError } from '../../domain/errors';
import type { ExecutionSelection, JsonObject } from '../../domain/models';
import type { ArtifactStore } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
import type { EventCardFormatter, EventConsumer, EventConsumerStore, EventQuery } from '../../ports/event-consumers';
import type { EventInbox, InboxEvent } from '../../ports/events';
import type { LarkClient } from '../../ports/lark';
import { eventKey, eventParameters, eventSetup } from './keys';
import { processEventKey } from './processors';
const obj = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const duration = (value: unknown): number => { if (value === undefined || value === '' || value === 0 || value === '0') return 0; const text=String(value); let matched='',ms=0;for(const match of text.matchAll(/(\d+(?:\.\d+)?)(h|ms|m|s)/g)){matched+=match[0];ms+=Number(match[1])*({h:3600000,m:60000,s:1000,ms:1}[match[2]!]??0);} if(matched!==text)throw new ServiceError('INVALID_ARGUMENTS','timeout must be a nonnegative duration.');return ms;};
export interface ConsumeResponse {consumerId:string;status:EventConsumer['status'];cursor:number;emitted:number;events:unknown[];diagnostics?:JsonObject[];artifacts?:JsonObject[]}
type Inbox = Pick<EventInbox,'read'> & {tail?(profile:string):Promise<number>;configured?(profile:string):Promise<boolean>;getSettings?(profile:string):Promise<string|undefined>};
export class EventConsumeService {
    constructor(private readonly store:EventConsumerStore,private readonly inbox:Inbox,private readonly artifacts:ArtifactStore,private readonly query?:EventQuery,private readonly card?:EventCardFormatter,private readonly now:()=>number=Date.now) {}
    private access(record:Pick<EventConsumer,'selection'|'key'|'outputDir'>,context:CommandContext) {
        if (record.selection.profileId!==context.selection.profileId||record.selection.identity!==context.selection.identity||record.selection.accountId!==context.selection.accountId) throw new ServiceError('SELECTION_REQUIRED','Use the consumer execution selection.',400,{selection:record.selection});
        authorize(context.grant,{...context.selection,domain:'event',risk:'read'},this.now());const domain=record.key.split('.')[0]!, business=domain==='card'?'im':domain==='board'?'whiteboard':domain;
        authorize(context.grant,{...context.selection,domain:business,risk:'read'},this.now());
        if(record.outputDir)authorize(context.grant,{...context.selection,domain:'artifact',risk:'write'},this.now());
    }
    private response(record:EventConsumer,events:unknown[]=[],diagnostics:JsonObject[]=[],artifacts:JsonObject[]=[]):ConsumeResponse {return {consumerId:record.id,status:record.status,cursor:record.cursor,emitted:record.emitted,events,...(diagnostics.length&&!record.quiet?{diagnostics}:{}),...(artifacts.length?{artifacts}:{})};}
    private async checkOwner(owner:string):Promise<void>{if(await this.store.ownerRevoked(owner))throw new ServiceError('GRANT_REVOKED','The consumer grant has been revoked.',401);}
    async start(args:JsonObject,context:CommandContext):Promise<ConsumeResponse> {
        await this.checkOwner(context.grant.id);
        const key=String(args['event-key']??''),definition=eventKey(key),params=eventParameters(key,args.param??args.params),maxEvents=Number(args['max-events']??0),timeout=duration(args.timeout),outputDir=String(args['output-dir']??''),jq=String(args.jq??'');
        if(!definition.auth_types.includes(context.selection.identity))throw new ServiceError('FORBIDDEN','This identity cannot consume the EventKey.',403);
        if(!Number.isSafeInteger(maxEvents)||maxEvents<0)throw new ServiceError('INVALID_ARGUMENTS','max-events must be a nonnegative integer.');
        if(outputDir.split(/[\\/]/).includes('..')||/[\x00-\x1f]/.test(outputDir))throw new ServiceError('INVALID_ARGUMENTS','Output directory cannot contain traversal or control characters.');
        this.access({key,selection:context.selection,outputDir},context);if(!await (this.inbox.configured ? this.inbox.configured(context.selection.profileId) : this.inbox.getSettings?.(context.selection.profileId)))throw new ServiceError('CALLBACK_NOT_CONFIGURED','Configure verified app callbacks before consuming EventKeys.',409);
        if(jq){if(!this.query)throw new ServiceError('NOT_CONFIGURED','JQ processing is unavailable.',503);await this.query.process({operation:'jq-validate',expression:jq});}
        const cursor=args.cursor===undefined?await this.inbox.tail?.(context.selection.profileId)??0:Number(args.cursor);if(!Number.isSafeInteger(cursor)||cursor<0)throw new ServiceError('INVALID_ARGUMENTS','cursor must be a nonnegative integer.');
        const group=JSON.stringify([context.selection.profileId,context.selection.identity,context.selection.accountId??'',key,params]),id=crypto.randomUUID(),joined=await this.store.join(group,id,definition.single_consumer===true);
        const record:EventConsumer={id,owner:context.grant.id,selection:context.selection,key,params,group,cursor,emitted:0,maxEvents,expiresAt:Math.min(context.grant.expiresAt,timeout?this.now()+timeout:context.grant.expiresAt),quiet:args.quiet===true,revision:0,status:'starting',setupIndex:0,leader:joined.leader,...(jq?{jq}:{}),...(outputDir?{outputDir}:{}),pending:{identityResolved:context.selection.identity==='bot'}};
        try{await this.store.create(record);}catch(error){if(await this.store.leave(group,id))await this.store.removeGroup(group);throw error;}
        return this.response(record);
    }
    private async owned(id:string,context:CommandContext):Promise<EventConsumer>{await this.checkOwner(context.grant.id);const record=await this.store.get(context.grant.id,id);if(!record)throw new ServiceError('CONSUMER_NOT_FOUND','Event consumer is unavailable.',404);this.access(record,context);return record;}
    private async claim(record:EventConsumer):Promise<EventConsumer>{if(record.status==='uncertain'||record.status==='polling')throw new ServiceError('OUTCOME_UNCERTAIN','The previous consumer operation may still be running or its outcome is unknown.',409);const claimed={...record,status:'polling' as const,revision:record.revision+1};if(!await this.store.transition(claimed,record.revision))throw new ServiceError('CONSUMER_BUSY','Another invocation acquired the consumer.',409);return claimed;}
    private async save(claimed:EventConsumer,next:EventConsumer):Promise<EventConsumer>{const saved={...next,revision:claimed.revision+1};if(!await this.store.transition(saved,claimed.revision))throw new Error('Consumer checkpoint was not committed.');return saved;}
    private async failure(claimed:EventConsumer,error:unknown):Promise<never>{const uncertain=!(error instanceof ServiceError)||error.code==='OUTCOME_UNCERTAIN',failure=uncertain?new ServiceError('OUTCOME_UNCERTAIN','Event consumer outcome could not be confirmed. Do not repeat the initial operation.',502):error;await this.save(claimed,{...claimed,status:uncertain?'uncertain':'failed',error:safeError(failure)});throw failure;}
    async status(id:string,context:CommandContext):Promise<ConsumeResponse>{return this.response(await this.owned(id,context));}
    async list(context:CommandContext):Promise<ConsumeResponse[]>{await this.checkOwner(context.grant.id);const records=await this.store.list(context.grant.id);return records.filter(record=>record.selection.profileId===context.selection.profileId&&record.selection.identity===context.selection.identity&&record.selection.accountId===context.selection.accountId).map(record=>{this.access(record,context);return this.response(record);});}
    private visible(record:EventConsumer,event:InboxEvent,context:CommandContext):boolean {
        if(record.selection.identity==='bot')return true;
        try{authorize(context.grant,{profileId:record.selection.profileId,identity:'bot',domain:'event',risk:'read'},this.now());return true;}catch{ /* Account grants require a proven recipient. */ }
        // None of the pinned user EventKey envelopes declares a recipient identity.
        // Actor, organizer, assignee and arbitrary payload fields are not recipients.
        return false;
    }
    async poll(id:string,context:CommandContext):Promise<ConsumeResponse>{
        const record=await this.owned(id,context);if(record.status==='stopped')return this.response(record);if(record.status==='failed')throw new ServiceError(record.error?.code??'CONSUMER_FAILED',record.error?.message??'Consumer failed.',409);if(record.expiresAt<=this.now()||record.maxEvents>0&&record.emitted>=record.maxEvents)return this.stop(id,context);
        const claimed=await this.claim(record);try{
            if(record.status==='starting'){
                const pending={...record.pending};if(!pending.identityResolved){const data=await context.lark.request({method:'GET',path:'/open-apis/authen/v1/user_info'});if(!data.open_id)throw new ServiceError('INVALID_RESPONSE','User identity response omitted open_id.',502);pending.openId=data.open_id;pending.identityResolved=true;return this.response(await this.save(claimed,{...record,pending}));}
                const setup=eventSetup(record.key,record.params);if(record.leader&&record.setupIndex<setup.start.length){await context.lark.request(setup.start[record.setupIndex]!);return this.response(await this.save(claimed,{...record,setupIndex:record.setupIndex+1}));}
                if(record.leader)await this.store.activate(record.group,record.id);return this.response(await this.save(claimed,{...record,status:'active'}));
            }
            let cursor=record.cursor,pending={...record.pending},raw:InboxEvent&{sequence:number}|undefined,diagnostics:JsonObject[]=[];
            if(pending.event)raw=pending.event as unknown as InboxEvent&{sequence:number};else{const page=await this.inbox.read(record.selection.profileId,cursor,100);for(const event of page.events){cursor=event.sequence;if(event.type!==record.key)continue;if(record.key==='board.whiteboard.updated_v1'&&obj(event.payload.event).whiteboard_id!==record.params.whiteboard_id)continue;if(!this.visible(record,event,context)){diagnostics.push({reason:'recipient_not_proven'});continue;}raw=event;break;}if(!raw)cursor=page.cursor;}
            if(raw&&!this.visible(record,raw,context)){cursor=raw.sequence;delete pending.event;delete pending.process;diagnostics.push({reason:'recipient_not_proven'});return this.response(await this.save(claimed,{...record,cursor,status:'active',pending}),[],diagnostics);}
            if(!raw)return this.response(await this.save(claimed,{...record,cursor,status:'active'}),[],diagnostics);
            let output:unknown,emit=false;try{const processed=await processEventKey(raw,context,obj(pending.process),this.card);if(!processed.done){pending.event=raw;pending.process=processed.state;return this.response(await this.save(claimed,{...record,cursor,status:'active',pending}),[],diagnostics);}output=processed.output;emit=output!==null;}catch(error){diagnostics.push({event_id:raw.id,reason:'process_error',...safeError(error)});output=null;}
            delete pending.event;delete pending.process;
            if(output!==null&&record.jq){try{const values=await this.query!.process({operation:'jq',expression:record.jq,input:output});emit=Array.isArray(values)&&values.length>0;output=emit?(values as unknown[])[0]:undefined;}catch(error){diagnostics.push({event_id:raw.id,reason:'jq_error',...safeError(error)});output=undefined;emit=false;}}
            const emissions=emit?[output]:[],artifacts:JsonObject[]=[];if(emissions.length&&record.outputDir){const bytes=new TextEncoder().encode(JSON.stringify(output)+'\n'),artifact=await this.artifacts.upload(record.owner,bytes.length,new Blob([bytes]).stream());artifacts.push({artifact_id:artifact.id,name:`${record.outputDir}/${raw.sequence}_${raw.id.replace(/[^a-zA-Z0-9_-]/g,'_')}.json`,size:bytes.length});}
            return this.response(await this.save(claimed,{...record,cursor:raw.sequence,emitted:record.emitted+emissions.length,status:'active',pending}),emissions,diagnostics,artifacts);
        }catch(error){return this.failure(claimed,error);}
    }
    async stop(id:string,context:CommandContext):Promise<ConsumeResponse>{return this.stopRecord(await this.owned(id,context),context.lark);}
    private async stopRecord(record:EventConsumer,lark:LarkClient):Promise<ConsumeResponse>{if(record.status==='stopped')return this.response(record);const claimed=await this.claim(record);try{const last=record.pending?.cleanupNeeded===true||await this.store.leave(record.group,record.id),setup=eventSetup(record.key,record.params);claimed.pending={...record.pending,cleanupNeeded:last};if(last&&setup.stop&&(record.status==='active'||record.setupIndex>0||!record.leader))await lark.request(setup.stop);if(last)await this.store.removeGroup(record.group);return this.response(await this.save(claimed,{...record,status:'stopped',pending:{}}));}catch(error){return this.failure(claimed,error);}}
    async revokeOwner(owner:string,createClient:(selection:ExecutionSelection)=>Promise<LarkClient>):Promise<{stopped:number;failed:number}>{await this.store.revokeOwner(owner);let stopped=0,failed=0;for(const record of (await this.store.list(owner)).filter(record=>!['stopped','uncertain','polling'].includes(record.status)).slice(0,10)){try{await this.stopRecord(record,await createClient(record.selection));stopped++;}catch{failed++;}}return {stopped,failed};}
    async cleanup(createClient:(selection:ExecutionSelection)=>Promise<LarkClient>):Promise<{stopped:number;failed:number}>{let stopped=0,failed=0;for(const record of await this.store.expired(this.now(),25)){try{await this.stopRecord(record,await createClient(record.selection));stopped++;}catch{failed++;}}await this.store.prune?.(this.now()-86400_000);return {stopped,failed};}
}
export const createEventConsumerCleanup=(service:EventConsumeService,createClient:(selection:ExecutionSelection)=>Promise<LarkClient>)=>()=>service.cleanup(createClient);

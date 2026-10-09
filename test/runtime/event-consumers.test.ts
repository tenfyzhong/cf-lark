import { env,runInDurableObject } from 'cloudflare:test';
import { expect,it,vi } from 'vitest';
import { EventConsumeService } from '../../src/capabilities/event/lifecycle';
import { eventConsumerCapabilities } from '../../src/capabilities/event/lifecycle-capabilities';
import { SqliteEventConsumerStore } from '../../src/infrastructure/storage/event-consumers';
import { SqliteOAuthStore } from '../../src/infrastructure/storage/oauth-store';
import { SqliteEventInbox } from '../../src/infrastructure/storage/event-inbox';
import { SecretBox } from '../../src/infrastructure/crypto/secret-box';
import { ArtifactService } from '../../src/application/artifacts';
import { SqliteArtifactLedger } from '../../src/infrastructure/storage/artifact-ledger';
import { PrivateR2Bucket } from '../../src/infrastructure/storage/r2-bucket';
import { baseRecordFormatter,imCardFormatter } from '../../src/infrastructure/documents/adapter';
import { Dispatcher } from '../../src/application/dispatcher';
import { Registry } from '../../src/capabilities/registry';
import { SchemaValidator } from '../../src/infrastructure/validation/schema-validator';
import { mcpResponse } from '../../src/adapters/mcp/handler';
import type { Env } from '../../src/bootstrap/worker';
import type { Grant,JsonObject } from '../../src/domain/models';
const grant:Grant={id:'event-native',revoked:false,expiresAt:Date.now()+3600000,profiles:[{profileId:'p',accounts:[],identities:['bot']}],domains:['event','im','artifact'],permissions:['read','write']};
async function call(dispatcher:Dispatcher,command:string,args:JsonObject):Promise<JsonObject>{
    const response=await mcpResponse(new Request('https://service.example/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'lark_execute',arguments:{command,args,identity:'bot'}}})}),dispatcher,grant);
    const body=await response.json() as {result:{isError?:boolean;structuredContent:JsonObject;content:unknown}};expect(body.result.isError,JSON.stringify(body.result.content)).not.toBe(true);return body.result.structuredContent.data as JsonObject;
}
it('consumes verified inbox pages through MCP, native SQLite, exact JQ and private R2',async()=>{
    const bindings=env as unknown as Env;await runInDurableObject(bindings.AUTHORITY.getByName('event-native-mcp'),async(_instance,state)=>{
        const inbox=new SqliteEventInbox(state.storage.sql);await inbox.putSettings('p','configured-fixture');
        const artifacts=new ArtifactService(new SqliteArtifactLedger(state.storage.sql,{maxBytes:2_000_000_000,maxClassA:10000,maxClassB:10000}),new PrivateR2Bucket(bindings.ARTIFACTS));
        const store=new SqliteEventConsumerStore(state.storage.sql,new SecretBox('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='));
        const service=new EventConsumeService(store,inbox,artifacts,baseRecordFormatter,imCardFormatter),request=vi.fn(async():Promise<JsonObject>=>({}));
        const dispatcher=new Dispatcher(new Registry(eventConsumerCapabilities(service)),new SchemaValidator(),async()=>({request}));
        const created=await call(dispatcher,'event.consume',{'event-key':'im.chat.updated_v1',jq:'.event | {chat_id, title: .name}','output-dir':'events','max-events':1});
        await inbox.append('p',{id:'e1',type:'im.chat.updated_v1',payload:{schema:'2.0',header:{event_id:'e1',token:'secret-verification'},event:{chat_id:'oc_native',name:'Private title'}}});
        await call(dispatcher,'event.consume',{consumerId:created.consumerId});
        const output=await call(dispatcher,'event.consume',{consumerId:created.consumerId});
        expect(output.events).toEqual([{chat_id:'oc_native',title:'Private title'}]);expect(output.emitted).toBe(1);
        const artifact=(output.artifacts as JsonObject[])[0]!;expect(await (await artifacts.read(grant.id,String(artifact.artifact_id))).text()).toContain('Private title');
        expect(await call(dispatcher,'event.consume',{consumerId:created.consumerId})).toMatchObject({status:'stopped'});expect(request).not.toHaveBeenCalled();
        for(const row of state.storage.sql.exec('SELECT payload FROM event_consumers'))expect(String(row.payload)).not.toContain('Private title');
        const oauth=new SqliteOAuthStore(state.storage.sql);oauth.setGrantRevocationHook(owner=>service.revokeOwner(owner,async()=>({request})));
        await oauth.put('grant:owner:provider-native',JSON.stringify({id:'provider-native',userId:'owner',metadata:{grantId:grant.id}}));await oauth.delete('grant:owner:provider-native');
        expect(await store.ownerRevoked(grant.id)).toBe(true);expect(await oauth.drainGrantRevocations()).toEqual({delivered:0,failed:0});
        await expect(service.start({'event-key':'im.chat.updated_v1'},{grant,selection:{profileId:'p',identity:'bot'},lark:{request}})).rejects.toMatchObject({code:'GRANT_REVOKED'});
    });
},120000);

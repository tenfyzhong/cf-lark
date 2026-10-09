import { expect, it, vi } from 'vitest';
import { baseRecordFormatter } from '../../src/infrastructure/documents/adapter';
import { genericApiProgram } from '../../src/capabilities/raw-api/runner';
import type { CommandContext } from '../../src/ports/capabilities';
function context(value: Record<string,unknown>): CommandContext {
    return { selection:{profileId:'p',identity:'user',accountId:'a'}, grant:{id:'jq-native',revoked:false,expiresAt:Date.now()+3600000,domains:['api'],permissions:['read'],profiles:[{profileId:'p',identities:['user'],accounts:['a']}]},lark:{request:async()=>value} };
}
it('evaluates the supported 1 MiB text input boundary in native workerd with the exact jq engine',async()=>{
    const overhead=JSON.stringify({ok:true,data:{text:''}}).length;
    const value={text:'x'.repeat(1024*1024-overhead)};
    const process=vi.fn(baseRecordFormatter.process.bind(baseRecordFormatter));
    const result=await genericApiProgram({id:'native-jq',domain:'api',risk:'read'},{formatter:{process}}).step({plan:{request:{method:'GET',path:'/open-apis/x/v1/y'},jq:'.data.text | length'}},context(value));
    expect(result).toEqual({done:true,output:[value.text.length]});expect(process).toHaveBeenCalledTimes(2);
});
it('evaluates the supported 16,384-value input boundary without a complete-output projection',async()=>{
    const value={items:Array.from({length:16380},(_,i)=>i)};
    const result=await genericApiProgram({id:'native-jq',domain:'api',risk:'read'},{formatter:baseRecordFormatter}).step({plan:{request:{method:'GET',path:'/open-apis/x/v1/y'},jq:'.data.items | length'}},context(value));
    expect(result).toEqual({done:true,output:[16380]});
});

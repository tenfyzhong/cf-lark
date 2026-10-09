import { describe, expect, it, vi } from 'vitest';
import { prepareRawAPI, rawApiCapability } from '../src/capabilities/raw-api/commands';
import { genericApiProgram, type ApiPlan } from '../src/capabilities/raw-api/runner';
import type { CommandContext } from '../src/ports/capabilities';
const context = { selection: { profileId: 'p', identity: 'user', accountId: 'a' }, grant: { id: 'g', profiles: [{ profileId: 'p', identities: ['user'], accounts: ['a'] }], domains: ['api','artifact'], permissions: ['read','write'], expiresAt: Date.now()+3600000, revoked:false }, lark: { request: vi.fn() } } as CommandContext;
describe('raw API preparation',()=>{
 it('normalizes URL paths while retaining exact JSON values and page size',async()=>{
  expect(await prepareRawAPI({method:'post',path:'https://untrusted.example/open-apis/new/v1/items',params:'{"enabled":false}',data:'[0,false,null]', 'page-size':25})).toMatchObject({request:{method:'POST',path:'/open-apis/new/v1/items',query:{enabled:false,page_size:25},body:[0,false,null]}});
 });
 it('rejects unsafe paths and incompatible transfers before requests',async()=>{
  for(const path of ['/open-apis/x/../y','/open-apis/x?q=1','/open-apis/%252e%252e/y'])await expect(prepareRawAPI({method:'GET',path})).rejects.toThrow();
  for(const args of [{file:'artifact:x/a.txt',output:'x'},{file:'artifact:x/a.txt','page-all':true},{output:'x','page-all':true},{jq:'.',format:'csv'},{jq:'.',output:'x'}])await expect(prepareRawAPI({method:'POST',path:'x/v1/y',...args})).rejects.toThrow();
 });
 it('keeps artifact previews isolated',async()=>{const start=vi.fn();const c=rawApiCapability({workflows:{start} as never});expect(await c.preview({method:'POST',path:'x/v1/y',data:'@artifact:body'})).toMatchObject({artifact_inputs:true});expect(start).not.toHaveBeenCalled();});
});
describe('shared API durable execution',()=>{
 it('merges pages in pinned priority, propagates last has_more and validates jq before writes',async()=>{
  const request=vi.fn().mockResolvedValueOnce({items:[1],files:['x'],has_more:true,next_page_token:'next',notice:'first'}).mockResolvedValueOnce({items:[2],has_more:true,page_token:'last'});
  const formatter={process:vi.fn(async (input:any)=>input.operation==='jq-validate'?true:[input.input.data.items])};
  const program=genericApiProgram({id:'api-read',domain:'api',risk:'read'},{formatter});
  const plan:ApiPlan={request:{method:'GET',path:'/open-apis/x/v1/items'},pageAll:true,pageLimit:2,pageDelay:100,jq:'.data.items'};
  let state:any={plan};let r=await program.step(state,{...context,lark:{request}});expect(r.done).toBe(false);if(r.done)return;expect(r.retryAfter).toBe(100);r=await program.step(r.state,{...context,lark:{request}});expect(r).toMatchObject({done:true,output:[[1,2]]});expect(request.mock.calls[1]![0].query).toEqual({page_token:'next'});
 });
 it('prevents mutation requests from read programs',async()=>{const request=vi.fn();await expect(genericApiProgram({id:'read',domain:'api',risk:'read',methods:['GET']},{}).step({plan:{request:{method:'POST',path:'/open-apis/x/v1/items'}}},{...context,lark:{request}})).rejects.toThrow();expect(request).not.toHaveBeenCalled();});
});
it('streams multipart artifacts with exact method/fields and enforces independent consent',async()=>{
 const artifacts={stat:vi.fn(async()=>({size:3})),read:vi.fn(async()=>new Response('abc'))} as any;
 const uploadStream=vi.fn(async(input:any)=>{expect(await new Response(input.file.body).text()).toBe('abc');return {file_key:'saved'};});
 const program=genericApiProgram({id:'write',domain:'api',risk:'write'},{artifacts});
 const plan=await prepareRawAPI({method:'PATCH',path:'files/v1/upload',params:{type:'x'},data:{flag:false,count:0,meta:{x:1}},file:'image=artifact:owned/picture.png'});
 expect(await program.step({plan:plan as any},{...context,lark:{request:vi.fn(),uploadStream} as any})).toMatchObject({done:true,output:{file_key:'saved'}});
 expect(uploadStream).toHaveBeenCalledWith(expect.objectContaining({method:'PATCH',fields:{flag:'false',count:'0',meta:'{"x":1}'},file:expect.objectContaining({field:'image',name:'picture.png',size:3})}));
 await expect(program.step({plan:plan as any},{...context,grant:{...context.grant,domains:['api']},lark:{request:vi.fn(),uploadStream} as any})).rejects.toMatchObject({code:'FORBIDDEN'});
 expect(uploadStream).toHaveBeenCalledTimes(1);
});
it('stores unknown-length binary downloads in private artifacts before returning a link',async()=>{
 const artifacts={ingest:vi.fn(async(owner:string,max:number,body:ReadableStream)=>{expect(owner).toBe('g');expect(await new Response(body).text()).toBe('filebytes');return{id:'download',size:9};})} as any;
 const download=vi.fn(async()=>new Response('filebytes'));
 const plan=await prepareRawAPI({method:'POST',path:'export/v1/file',data:{id:'x'},output:'result.csv'});
 expect(await genericApiProgram({id:'write',domain:'api',risk:'write'},{artifacts}).step({plan:plan as any},{...context,lark:{request:vi.fn(),download} as any})).toMatchObject({done:true,output:{artifact_id:'download',size_bytes:9,filename:'result.csv'}});
 expect(download).toHaveBeenCalledWith(expect.objectContaining({method:'POST',body:{id:'x'}}));
});
it('hydrates private JSON while rejecting scope loss and oversized metadata',async()=>{
 const artifacts={stat:vi.fn(async()=>({size:12})),read:vi.fn(async()=>new Response('{"ok":false}'))} as any;
 expect(await prepareRawAPI({method:'POST',path:'x/v1/y',data:'@artifact:body'},context,{artifacts})).toMatchObject({request:{body:{ok:false}}});
 artifacts.stat.mockResolvedValueOnce({size:3*1024*1024});
 await expect(prepareRawAPI({method:'POST',path:'x/v1/y',data:'@artifact:body'},context,{artifacts})).rejects.toThrow('2 MiB');
 expect(artifacts.read).toHaveBeenCalledTimes(1);
});
it('validates exact jq syntax before any upstream mutation and returns later-page incompleteness explicitly',async()=>{
 const request=vi.fn();const formatter={process:vi.fn(async()=>{throw new Error('invalid jq');})};
 await expect(genericApiProgram({id:'write',domain:'api',risk:'write'},{formatter}).step({plan:{request:{method:'POST',path:'/open-apis/x/v1/y'},jq:'bad('}},{...context,lark:{request}})).rejects.toThrow('invalid jq');expect(request).not.toHaveBeenCalled();
 request.mockResolvedValueOnce({items:[1],has_more:true,page_token:'next'}).mockRejectedValueOnce(new Error('offline'));
 const program=genericApiProgram({id:'read',domain:'api',risk:'read'},{});const first=await program.step({plan:{request:{method:'GET',path:'/open-apis/x/v1/y'},pageAll:true}},{...context,lark:{request}});if(first.done)throw Error('Expected next page');
 expect(await program.step(first.state,{...context,lark:{request}})).toMatchObject({done:true,output:{items:[1],has_more:true,partial:true}});
});
it('allows descriptor-authorized POST reads and rejects repeated pagination cursors',async()=>{
 const request=vi.fn(async()=>({items:[],has_more:true,page_token:'same'}));
 const program=genericApiProgram({id:'read',domain:'api',risk:'read'},{});
 const first=await program.step({plan:{request:{method:'POST',path:'/open-apis/search/v1/items'},pageAll:true}},{...context,lark:{request}});if(first.done)throw Error('Expected next page');
 await expect(program.step(first.state,{...context,lark:{request}})).rejects.toThrow('repeated token');
});
it('rejects oversized and overly structured jq inputs before invoking the evaluator',async()=>{
 const formatter={process:vi.fn(async(input:any)=>input.operation==='jq-validate'?true:input.input)};
 const program=genericApiProgram({id:'read',domain:'api',risk:'read'},{formatter});
 for(const value of [{text:'x'.repeat(1024*1024)},{items:Array.from({length:16384},()=>0)}]){
  const request=vi.fn(async()=>value);
  await expect(program.step({plan:{request:{method:'GET',path:'/open-apis/x/v1/y'},jq:'.data'}},{...context,lark:{request}})).rejects.toMatchObject({code:'JQ_INPUT_TOO_LARGE'});
 }
 expect(formatter.process.mock.calls.every(([input])=>input.operation==='jq-validate')).toBe(true);
});

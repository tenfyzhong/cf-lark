import { expect,it,vi } from 'vitest';
import type { OAuthResourceAuth } from '@cloudflare/workers-oauth-provider';
import { writeScopeChallenge } from '../../src/adapters/mcp/scope-challenge';
import { Registry } from '../../src/capabilities/registry';
import { fixtureValidator } from '../support/schema-validator';
const auth:OAuthResourceAuth={token:'fixture',scope:['mcp:read'],audience:'https://service.example/mcp'};
const execute=vi.fn(),preview=vi.fn();
const registry=new Registry([{definition:{id:'api.request',domain:'api',risk:'read',source:'api',identities:['bot'],scopes:[],description:'Fixture',inputSchema:{type:'object',required:['method'],additionalProperties:false,properties:{method:{enum:['GET','POST']}}}},normalize:args=>({...args,method:typeof args.method==='string'?args.method.toUpperCase():args.method}),risk:args=>args.method==='GET'?'read':'write',execute,preview}]);
const request=(name:string,args:unknown)=>new Request('https://service.example/mcp',{method:'POST',body:JSON.stringify({method:'tools/call',params:{name,arguments:args}})});
it('challenges normalized validated dynamic writes without executing a command',async()=>{
    const response=await writeScopeChallenge(request('lark_execute',{command:'api.request',args:{method:'post'}}),auth,registry,fixtureValidator());
    expect(response?.status).toBe(403);expect(response?.headers.get('WWW-Authenticate')).toContain('insufficient_scope');expect(execute).not.toHaveBeenCalled();expect(preview).not.toHaveBeenCalled();
});
it('does not challenge read branches, malformed inputs, or mixed-risk discovery',async()=>{
    for(const args of [{method:'GET'},{method:'INVALID'},{method:'POST',unknown:true},null])expect(await writeScopeChallenge(request('lark_execute',{command:'api.request',args}),auth,registry,fixtureValidator())).toBeUndefined();
    expect(await writeScopeChallenge(request('lark_schema',{command:'api.request'}),auth,registry,fixtureValidator())).toBeUndefined();
    expect(await writeScopeChallenge(request('lark_search',{query:'request'}),auth,registry,fixtureValidator())).toBeUndefined();
});
it('bounds scope preflight JSON before the MCP transport body parser',async()=>{
    const oversized=new Request('https://service.example/mcp',{method:'POST',body:' '.repeat(4*1024*1024+1)});
    expect((await writeScopeChallenge(oversized,auth,registry,fixtureValidator()))?.status).toBe(413);
});

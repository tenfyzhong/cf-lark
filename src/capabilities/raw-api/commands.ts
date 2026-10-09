import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
import { validateApiPath } from '../../domain/upstream';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { WorkflowRunner } from '../../ports/workflows';
import type { ApiRequest } from '../../ports/lark';
import { rawApiDefinition } from './definitions';
import { invalid, object, parseFile, resolveJSON } from './input';
import { executeApi, genericApiProgram, validatePlan, type ApiDependencies, type ApiPlan } from './runner';
export async function prepareRawAPI(args: JsonObject, context?: CommandContext, deps: ApiDependencies = {}): Promise<ApiPlan> {
    const method=String(args.method??'').toUpperCase();
    if (!['GET','POST','PUT','PATCH','DELETE'].includes(method)) invalid('Supported methods are GET, POST, PUT, PATCH and DELETE.');
    let path=String(args.path??'');
    if (/[?#]/u.test(path)) invalid('Supply query parameters in params, without query strings or fragments.');
    if (/^https?:\/\//iu.test(path)) { const match=path.match(/^https?:\/\/[^/]+(\/open-apis\/.+)$/iu); if(!match)invalid('URL must contain an Open API path.'); path=match![1]!; }
    else if(!path.startsWith('/open-apis/'))path='/open-apis/'+path.replace(/^\//u,'');
    validateApiPath(path);
    if(args.body!==undefined&&args.data!==undefined)invalid('Provide body or data, not both.');
    const params=await resolveJSON(args.params,'params',context,deps.artifacts);
    if(params!==undefined&&params!==null&&!object(params))invalid('params must be a JSON object.');
    const query={...(params as JsonObject??{})};
    if(typeof args['page-size']==='number'&&args['page-size']>0)query.page_size=args['page-size'];
    const body=method==='GET'?undefined:await resolveJSON(args.data??args.body,'data',context,deps.artifacts);
    const plan:ApiPlan={request:{method:method as ApiRequest['method'],path,query,...(body===undefined?{}:{body})},pageAll:args['page-all']===true,pageLimit:args['page-limit'] as number|undefined,pageDelay:args['page-delay'] as number|undefined,format:args.json===true?'json':String(args.format??'json'),jq:typeof args.jq==='string'?args.jq:undefined,file:parseFile(args.file),output:typeof args.output==='string'&&args.output?args.output:undefined};
    await validatePlan(plan,{...deps,...(!context&&plan.jq&&!deps.formatter?{formatter:{process:async()=>true}}:{})});
    return plan;
}
export function rawApiCapability(deps: ApiDependencies & { workflows?: WorkflowRunner }): Capability {
    return {definition:rawApiDefinition,risk:args=>String(args.method).toUpperCase()==='GET'?'read':'write',preview:async args=>{
        const hydrated=Object.values(args).some(v=>typeof v==='string'&&v.startsWith('@'));
        if(hydrated){const sanitized={...args};for(const key of ['params','data','body'])if(typeof sanitized[key]==='string'&&String(sanitized[key]).startsWith('@'))delete sanitized[key];return {operation:'api.request',...await prepareRawAPI(sanitized,undefined,deps),artifact_inputs:true};}
        return prepareRawAPI(args,undefined,deps);
    },execute:async(args,context)=>{
        if(!deps.workflows)throw new ServiceError('UNAVAILABLE','API workflow runner is unavailable.',503);
        const plan=await prepareRawAPI(args,context,deps);
        return executeApi(plan,context,deps,deps.workflows,plan.request.method==='GET'?'raw-api-read':'raw-api-write');
    }};
}
export function rawApiPrograms(deps:ApiDependencies){return (['read','write'] as const).map(risk=>genericApiProgram({id:`raw-api-${risk}`,domain:'api',risk,methods:risk==='read'?['GET']:['POST','PUT','PATCH','DELETE']},deps));}
export { rawApiDefinition } from './definitions';

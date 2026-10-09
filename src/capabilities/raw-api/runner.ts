import { ServiceError } from '../../domain/errors';
import { authorize } from '../../domain/authorization';
import { validateApiPath } from '../../domain/upstream';
import type { JsonObject, Risk } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
import type { ApiRequest, LarkTransferClient } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import type { BaseRecordFormatter } from '../base/record-export';
import { saveDownloadResponse } from '../files/download';
import { invalid, object, type ApiFile } from './input';
export interface ApiPlan { request: ApiRequest; pageAll?: boolean; pageLimit?: number; pageDelay?: number; jq?: string; format?: string; file?: ApiFile; output?: string; }
export interface ApiDependencies { artifacts?: ArtifactFiles; formatter?: BaseRecordFormatter; }
const priority = ['items','files','events','rooms','records','nodes','members','departments','calendar_list','acl_list','freebusy_list','users'];
function arrayField(data: JsonObject): string | undefined { return [...priority, ...Object.keys(data).sort()].find(key => Array.isArray(data[key])); }
function merge(pages: JsonObject[]): JsonObject {
    const first = pages[0] ?? {}, key = arrayField(first);
    if (!key) return { pages };
    const result = { ...first, [key]: pages.flatMap(page => Array.isArray(page[key]) ? page[key] as unknown[] : []), has_more: pages.at(-1)?.has_more === true };
    delete result.page_token; delete result.next_page_token; return result;
}
export async function validatePlan(plan: ApiPlan, deps: ApiDependencies): Promise<void> {
    validateApiPath(plan.request.path);
    if (plan.file && (plan.output || plan.pageAll || plan.request.method === 'GET')) invalid('file conflicts with GET, output and page-all.');
    if (plan.output && plan.pageAll) invalid('output and page-all are mutually exclusive.');
    if (plan.jq && (plan.output || plan.format && plan.format !== 'json')) invalid('jq requires JSON output and cannot accompany output.');
    if (plan.file && plan.request.body !== undefined && !object(plan.request.body)) invalid('Multipart data must be a JSON object.');
    for (const [name,value] of [['page-limit',plan.pageLimit],['page-delay',plan.pageDelay]] as const) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) invalid(`${name} must be a nonnegative integer.`);
    if (plan.jq) { if (!deps.formatter) throw new ServiceError('UNAVAILABLE','The jq engine is unavailable.',503); await deps.formatter.process({ operation:'jq-validate', expression:plan.jq }); }
}
export function validateJqInput(value: unknown): void {
    const fail = (): never => { throw new ServiceError('JQ_INPUT_TOO_LARGE','jq input exceeds the hosted 1 MiB or 16,384-value budget. Narrow the upstream result or omit jq.',413); };
    let nodes=1, characters=0; const pending:unknown[]=[value];
    while(pending.length){ const item=pending.pop(); if(typeof item==='string'){characters+=item.length;if(characters>1024*1024)fail();} else if(item && typeof item==='object'){const children=Array.isArray(item)?item:Object.values(item);nodes+=children.length;if(nodes>16384)fail();for(const child of children)pending.push(child);} }
    if(new TextEncoder().encode(JSON.stringify(value)).byteLength>1024*1024)fail();
}
async function output(value: JsonObject, plan: ApiPlan, deps: ApiDependencies): Promise<unknown> {
    if (plan.jq) { const input={ok:true,data:value}; validateJqInput(input); return deps.formatter!.process({ operation:'jq', expression:plan.jq, input }); }
    if (plan.format && plan.format !== 'json') { const key=arrayField(value), metadata={...value}; if(key)delete metadata[key]; return { requested_format:plan.format, representation:'structured-json', records:key?value[key]:[value], metadata:key?metadata:{} }; }
    return value;
}
export function genericApiProgram(config: { id: string; domain: string; risk: Risk; methods?: ApiRequest['method'][] }, deps: ApiDependencies): WorkflowProgram {
    return { ...config, version:1, identities:['user','bot'], step: async (state,context) => {
        const plan = state.plan as unknown as ApiPlan;
        if (config.methods && !config.methods.includes(plan.request.method)) invalid('This workflow does not permit the requested HTTP method.');
        authorize(context.grant,{...context.selection,domain:config.domain,risk:config.risk},Date.now());
        if (!state.validated) await validatePlan(plan,deps);
        const transfer = context.lark as LarkTransferClient;
        if (plan.file) {
            if (!deps.artifacts || !transfer.uploadStream) throw new ServiceError('UNAVAILABLE','Streaming artifact upload is unavailable.',503);
            authorize(context.grant,{...context.selection,domain:'artifact',risk:'read'},Date.now());
            const meta = await deps.artifacts.stat(context.grant.id,plan.file.id), response = await deps.artifacts.read(context.grant.id,plan.file.id);
            if (!response.body) invalid('The artifact has no body.');
            const fields:Record<string,string>={}; for(const [key,value] of Object.entries(plan.request.body as JsonObject ?? {})) fields[key]=typeof value==='string'?value:JSON.stringify(value);
            const value=await transfer.uploadStream({method:plan.request.method as 'POST'|'PUT'|'PATCH'|'DELETE',path:plan.request.path,query:plan.request.query,fields,file:{field:plan.file.field,name:plan.file.name,size:meta.size,body:response.body!}});
            return {done:true,output:await output(value,plan,deps)};
        }
        if (plan.output) {
            if (!deps.artifacts || !transfer.download) throw new ServiceError('UNAVAILABLE','Binary download is unavailable.',503);
            authorize(context.grant,{...context.selection,domain:'artifact',risk:'write'},Date.now());
            const response=await transfer.download({...plan.request});
            return {done:true,output:await saveDownloadResponse(deps.artifacts,context,response,plan.output)};
        }
        const pages=(state.pages ?? []) as JsonObject[], token=String(state.token??'');
        let value:JsonObject;
        try { value=await context.lark.request({...plan.request,...(token?{query:{...plan.request.query,page_token:token}}:{})}); }
        catch(error) { if (!pages.length || !plan.pageAll) throw error; return {done:true,output:await output({...merge(pages),has_more:true,partial:true,warning:'A later API page failed; collected results are incomplete.',error_code:error instanceof ServiceError?error.code:'UPSTREAM_ERROR'},plan,deps)}; }
        if (!plan.pageAll) return {done:true,output:await output(value,plan,deps)};
        const nextPages=[...pages,value], next=value.has_more===true?String(value.page_token||value.next_page_token||''):'';
        const limit=plan.pageLimit ?? 10;
        if (!next || limit>0 && nextPages.length>=limit) return {done:true,output:await output(merge(nextPages),plan,deps)};
        const seen=(state.seen??[]) as string[];
        if (seen.includes(next)) throw new ServiceError('INVALID_UPSTREAM_RESPONSE','Pagination returned a repeated token.',502);
        return {done:false,state:{plan:plan as unknown as JsonObject,validated:true,pages:nextPages,token:next,seen:[...seen,next]},retryAfter:plan.pageDelay || 200};
    } };
}
export async function executeApi(plan: ApiPlan, context: CommandContext, deps: ApiDependencies, workflows: WorkflowRunner, programId: string): Promise<unknown> {
    await validatePlan(plan,deps);
    return workflows.start(programId,{plan:plan as unknown as JsonObject,validated:true},context.selection,context.grant);
}

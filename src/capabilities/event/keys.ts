import catalog from './catalog.json';
import { ServiceError } from '../../domain/errors';
import type { Identity, JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
export interface EventKey { key: string; display_name: string; description: string; event_type: string; subscription_type: string; auth_types: Identity[]; scopes?: string[]; single_consumer?: boolean; params?: {name:string;type:string;required:boolean;default?:string;values?:{value:string;desc:string}[]}[]; resolved_output_schema: JsonObject; schema: JsonObject }
export const eventKeys = catalog as unknown as EventKey[];
export function eventKey(key: string): EventKey { const value = eventKeys.find(entry => entry.key === key); if (!value) throw new ServiceError('UNKNOWN_EVENT_KEY','Unknown EventKey. Use event.list for supported keys.'); return value; }
export function eventParameters(key: string, input: unknown): Record<string,string> {
    const definition = eventKey(key), raw: Record<string,string> = {};
    if (Array.isArray(input)) for (const item of input) { if (typeof item !== 'string' || !item.includes('=')) throw new ServiceError('INVALID_ARGUMENTS','Event parameters require key=value.'); const at = item.indexOf('='); raw[item.slice(0,at)] = item.slice(at+1); }
    else if (input && typeof input === 'object') for (const [name,value] of Object.entries(input)) raw[name] = typeof value === 'string' ? value : JSON.stringify(value);
    for (const name of Object.keys(raw)) if (!definition.params?.some(param => param.name === name)) throw new ServiceError('INVALID_ARGUMENTS',`Unknown EventKey parameter: ${name}.`);
    for (const param of definition.params ?? []) { const value = String(raw[param.name] ?? param.default ?? '').trim(); if (param.required && !value) throw new ServiceError('INVALID_ARGUMENTS',`EventKey parameter ${param.name} is required.`); if (value) raw[param.name] = value; }
    if (key.startsWith('approval.')) { let values: unknown = raw.subscription_type ? raw.subscription_type.startsWith('[') ? undefined : raw.subscription_type.split(',') : ['INVOLVED_APPROVAL','MANAGED_APPROVAL']; if (values === undefined) { try { values = JSON.parse(raw.subscription_type!); } catch { throw new ServiceError('INVALID_ARGUMENTS','Invalid subscription_type JSON.'); } } if (!Array.isArray(values) || !values.length || values.some(value => !['INVOLVED_APPROVAL','MANAGED_APPROVAL'].includes(String(value).trim()))) throw new ServiceError('INVALID_ARGUMENTS','Invalid approval subscription_type.'); raw.subscription_type = ['INVOLVED_APPROVAL','MANAGED_APPROVAL'].filter(value => (values as unknown[]).map(v => String(v).trim()).includes(value)).join(','); }
    return raw;
}
export function eventSetup(key: string, params: Record<string,string>): {start:ApiRequest[];stop?:ApiRequest} {
    const body = {event_type:key}; let path = '';
    if (key.startsWith('vc.meeting.')) path = '/open-apis/vc/v1/meetings';
    else if (key.startsWith('vc.recording.')) path = '/open-apis/vc/v1/recordings';
    else if (key === 'vc.note.generated_v1') path = '/open-apis/vc/v1/notes';
    else if (key === 'minutes.minute.generated_v1') path = '/open-apis/minutes/v1/minutes';
    if (path) return {start:[{method:'POST',path:path+'/subscription',body}],stop:{method:'POST',path:path+'/unsubscription',body}};
    if (key === 'board.whiteboard.updated_v1') { path = `/open-apis/board/v1/whiteboards/${encodeURIComponent(params.whiteboard_id!)}`; return {start:[{method:'POST',path:path+'/subscribe',body}],stop:{method:'POST',path:path+'/unsubscribe',body}}; }
    if (key === 'task.task.update_user_access_v2') return {start:[{method:'POST',path:'/open-apis/task/v2/task_v2/task_subscription',query:{user_id_type:'open_id'}}]};
    if (key.startsWith('approval.')) return {start:params.subscription_type!.split(',').map(value => ({method:'POST',path:`/open-apis/approval/v4/${key.includes('.instance.') ? 'instances' : 'tasks'}/subscription`,body:{subscription_type:value}}))};
    return {start:[]};
}

import type { CommandDefinition, JsonObject } from '../../domain/models';
const s={type:'string'},b={type:'boolean'};
const specs:{id:string;description:string;properties:JsonObject;required?:string[]}[]=[
    {id:'list',description:'List the 25 pinned EventKeys, identities, parameters, scopes and output schemas.',properties:{domain:s,json:b}},
    {id:'schema',description:'Return the exact pinned EventKey definition and resolved output schema.',properties:{'event-key':s,json:b},required:['event-key']},
    {id:'consume',description:'Start an EventKey consumer with event-key, then poll using consumerId. Verified callbacks must be configured. User EventKeys without recipient routing require an explicit bot/app event grant to expose profile events. Supports durable subscription setup, exact jq, bounded output, private artifacts and timeout cleanup.',properties:{'event-key':s,consumerId:s,param:{anyOf:[{type:'array',items:s},{type:'object',additionalProperties:s}]},params:{type:'object',additionalProperties:s},jq:s,quiet:b,'output-dir':s,'max-events':{type:'integer',minimum:0},timeout:s,'dry-run':b,cursor:{type:'integer',minimum:0}}},
    {id:'status',description:'Inspect one consumer or list consumers owned by this grant and execution selection.',properties:{consumerId:s}},
    {id:'stop',description:'Stop a durable consumer; the last consumer cleans up its upstream subscription where supported.',properties:{consumerId:s},required:['consumerId']},
];
export const eventConsumerDefinitions:CommandDefinition[]=specs.map(spec=>({id:`event.${spec.id}`,domain:'event',source:'service',risk:'read',identities:['user','bot'],scopes:[],description:spec.description,inputSchema:{type:'object',additionalProperties:false,properties:spec.properties,...(spec.required?{required:spec.required}:{})}}));

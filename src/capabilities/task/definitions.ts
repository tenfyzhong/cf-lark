import type { CommandDefinition, JsonObject } from '../../domain/models';
const text = { type: 'string' }, boolean = { type: 'boolean' };
const paging = { 'page-all': boolean, 'page-limit': { type: 'integer' }, 'page-token': text };
const inputs: Record<string, JsonObject> = {
    'get-my-tasks': { query: text, complete: boolean, created_at: text, 'due-start': text, 'due-end': text, ...paging },
    'get-related-tasks': { 'include-complete': boolean, 'created-by-me': boolean, 'followed-by-me': boolean, ...paging },
    search: { query: text, creator: text, assignee: text, completed: boolean, due: text, follower: text, ...paging },
    'tasklist-search': { query: text, creator: text, 'create-time': text, ...paging },
};
const queryDefinitions: CommandDefinition[] = Object.entries(inputs).map(([action, properties]) => ({
    id: `task.+${action}`, domain: 'task', source: 'shortcut', risk: 'read', identities: ['user'],
    scopes: [action === 'tasklist-search' ? 'task:tasklist:read' : 'task:task:read'],
    description: `Task ${action}. Dates use UTC unless an explicit offset is supplied. Resume pending results with workflow.resume until completed.`,
    inputSchema: { type: 'object', properties, additionalProperties: false },
}));

const writeInputs: Record<string, JsonObject> = {
    create: { summary: text, description: text, assignee: text, follower: text, due: text, 'tasklist-id': text, 'idempotency-key': text, data: { anyOf: [text, { type: 'object' }] } },
    update: { 'task-id': text, summary: text, description: text, due: text, data: { anyOf: [text, { type: 'object' }] } },
    complete: { 'task-id': text }, reopen: { 'task-id': text },
    'set-ancestor': { 'task-id': text, 'ancestor-id': text }, comment: { 'task-id': text, content: text },
    assign: { 'task-id': text, add: text, remove: text, 'idempotency-key': text },
    followers: { 'task-id': text, add: text, remove: text, 'idempotency-key': text },
    reminder: { 'task-id': text, set: text, remove: boolean },
    'tasklist-create': { name: text, member: text, data: { anyOf: [text, { type: 'array', items: { type: 'object' } }] } },
    'tasklist-members': { 'tasklist-id': text, set: text, add: text, remove: text },
    'tasklist-task-add': { 'tasklist-id': text, 'task-id': text, 'section-guid': text },
};
export const taskDefinitions: CommandDefinition[] = [...queryDefinitions, ...Object.entries(writeInputs).map(([action, properties]): CommandDefinition => ({
    id: `task.+${action}`, domain: 'task', source: 'shortcut', risk: 'write', identities: ['user', 'bot'],
    scopes: action === 'comment' ? ['task:comment:write'] : action === 'tasklist-members' ? ['task:tasklist:write'] : action === 'tasklist-create' ? ['task:tasklist:write', 'task:task:write'] : ['task:task:write'],
    description: `Task ${action}. Resume pending results with workflow.resume. Explicit flags override JSON data.`,
    inputSchema: { type: 'object', properties, additionalProperties: false },
}))];

taskDefinitions.push({
    id: 'task.+upload-attachment', domain: 'task', source: 'shortcut', risk: 'write', identities: ['user', 'bot'], scopes: ['task:attachment:write'],
    description: 'Upload a grant-owned artifact as a task attachment, at most 50 MiB. Requires artifact read permission. file is an artifact ID; name sets the original filename.',
    inputSchema: { type: 'object', required: ['resource-id', 'file'], properties: { 'resource-id': text, file: text, name: text, 'resource-type': text, 'user-id-type': text }, additionalProperties: false },
});

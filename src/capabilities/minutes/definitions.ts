import type { CommandDefinition, JsonObject } from '../../domain/models';
const s = { type: 'string' };
const token = { 'minute-token': { type: 'string', minLength: 1 } };
const jsonArray = { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }] };
const specs: { name: string; properties: JsonObject; required: string[]; scope?: string; both?: boolean }[] = [
    { name: 'update', properties: { ...token, topic: s }, required: ['minute-token', 'topic'] },
    { name: 'summary', properties: { ...token, summary: s }, required: ['minute-token', 'summary'] },
    { name: 'apply-permission', properties: { ...token, perm: { type: 'string', enum: ['view', 'edit'] } }, required: ['minute-token', 'perm'], scope: 'minutes:permission:apply', both: true },
    { name: 'upload', properties: { 'file-token': s }, required: ['file-token'], scope: 'minutes:minutes.upload:write' },
    { name: 'speaker-replace', properties: { ...token, 'from-speaker-id': s, 'from-user-id': s, 'to-user-id': s }, required: ['minute-token', 'to-user-id'] },
    { name: 'word-replace', properties: { ...token, 'replace-words': jsonArray }, required: ['minute-token', 'replace-words'] },
    { name: 'todo', properties: { ...token, operation: s, todo: s, 'is-done': { type: 'boolean' }, 'todo-id': s, todos: jsonArray }, required: ['minute-token'] },
];
export const minutesDefinitions: CommandDefinition[] = specs.map(spec => ({ id: `minutes.+${spec.name}`, domain: 'minutes', description: `${spec.name === 'summary' ? 'Replace the full AI summary' : spec.name === 'upload' ? 'Generate Minutes from an already uploaded Drive media file token' : `Perform Minutes ${spec.name}`}. Text and JSON inputs are inline; no local file paths. Writes are not automatically retried.`, source: 'shortcut', risk: 'write', identities: spec.both ? ['user', 'bot'] : ['user'], scopes: [...(spec.name === 'speaker-replace' ? ['minutes:minutes:readonly'] : []), spec.scope ?? 'minutes:minutes:update'], inputSchema: { type: 'object', additionalProperties: false, properties: spec.properties, required: spec.required } }));

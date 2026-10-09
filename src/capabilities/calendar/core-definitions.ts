import type { CommandDefinition, JsonObject } from '../../domain/models';
const s = { type: 'string' }, target = { 'calendar-id': s, 'event-id': s };
const specs: { name: string; properties: JsonObject; required?: string[]; scope?: string; write?: boolean; user?: boolean }[] = [
    { name: 'join-event', properties: { token: s, 'share-token': s }, scope: 'join', write: true },
    { name: 'rsvp', properties: { ...target, 'rsvp-status': { type: 'string', enum: ['accept', 'decline', 'tentative'] } }, required: ['event-id', 'rsvp-status'], scope: 'reply', write: true },
    { name: 'get', properties: target, required: ['event-id'] },
    { name: 'list-attendees', properties: { ...target, type: { anyOf: [s, { type: 'array', items: s }] }, 'page-size': { type: 'integer' }, 'page-token': s }, required: ['event-id'] },
    { name: 'search-event', properties: { 'calendar-id': s, query: s, 'attendee-ids': s, start: s, end: s, 'page-size': { anyOf: [s, { type: 'integer' }] }, 'page-token': s } },
    { name: 'meeting', properties: { 'calendar-id': s, 'event-ids': s }, required: ['event-ids'], user: true },
    { name: 'transfer', properties: { ...target, 'to-user-id': s, 'remove-original-organizer': { type: 'boolean' }, 'transfer-series': { type: 'boolean' } }, required: ['event-id', 'to-user-id'], scope: 'transfer', write: true },
];
export const calendarCoreDefinitions: CommandDefinition[] = specs.map(spec => ({ id: `calendar.+${spec.name}`, domain: 'calendar', source: 'shortcut', risk: spec.write ? 'write' : 'read', identities: spec.user ? ['user'] : ['user', 'bot'], scopes: [`calendar:calendar.event:${spec.scope ?? 'read'}`], description: `${spec.name === 'transfer' ? 'Irreversibly transfer event ownership; recurring series require explicit transfer-series. Read permission is required for the recurrence check.' : `Calendar ${spec.name} with primary calendar default and normalized structured output.`} ${['transfer', 'meeting'].includes(spec.name) ? 'Resume workflow.resume until completed.' : ''}`, inputSchema: { type: 'object', additionalProperties: false, properties: spec.properties, ...(spec.required ? { required: spec.required } : {}) } }));

import type { CommandDefinition, JsonObject } from '../../domain/models';
const s = { type: 'string' };
const meeting = { 'meeting-id': { type: 'string', minLength: 1 } };
const specs: { name: string; description: string; properties: JsonObject; required: string[]; scopes: string[]; bot?: boolean; read?: boolean }[] = [
    { name: 'meeting-join', description: 'Join or start a calendar meeting as the app bot.', properties: { 'meeting-number': s, password: s, 'call-id': s, action: s }, required: ['meeting-number'], scopes: ['vc:meeting.bot.join:write'], bot: true },
    { name: 'meeting-leave', description: 'Leave a meeting as the app bot.', properties: meeting, required: ['meeting-id'], scopes: ['vc:meeting.bot.join:write'], bot: true },
    { name: 'meeting-end', description: 'End the meeting for all participants as the host app bot.', properties: meeting, required: ['meeting-id'], scopes: ['vc:meeting.bot.manage:write'], bot: true },
    { name: 'meeting-invite', description: 'Invite selected or all eligible users as the app bot.', properties: { ...meeting, type: s, 'open-ids': { type: 'array', items: s } }, required: ['meeting-id', 'type'], scopes: ['vc:meeting.bot.join:write'], bot: true },
    { name: 'meeting-countdown', description: 'Set, prolong, end, or close an in-meeting countdown.', properties: { ...meeting, action: s, duration: { type: 'integer' }, 'need-play-audio-at-end': { type: 'boolean' }, 'reminder-before-end': { type: 'integer' } }, required: ['meeting-id', 'action'], scopes: ['vc:meeting.interaction:write'] },
    { name: 'meeting-message-send', description: 'Send an in-meeting text message or reaction with an optional idempotency key.', properties: { ...meeting, 'msg-type': s, text: s, 'emoji-type': s, uuid: s }, required: ['meeting-id'], scopes: ['vc:meeting.message:write'] },
    { name: 'meeting-list-active', description: 'List current active meetings. Bot identity requires user-id; user identity ignores it.', properties: { 'user-id': s }, required: [], scopes: ['vc:meeting.meetingevent:read'], read: true },
];
export const vcDefinitions: CommandDefinition[] = specs.map(spec => ({ id: `vc.+${spec.name}`, domain: 'vc', description: spec.description, source: 'shortcut', risk: spec.read ? 'read' : 'write', identities: spec.bot ? ['bot'] : ['user', 'bot'], scopes: spec.scopes, inputSchema: { type: 'object', additionalProperties: false, properties: spec.properties, required: spec.required } }));

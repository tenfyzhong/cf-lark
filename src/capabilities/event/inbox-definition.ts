import type { CommandDefinition } from '../../domain/models';
export const inboxDefinition: CommandDefinition = {
            id: 'event.inbox.read', domain: 'event', description: 'Read verified app-level callbacks. Requires explicit bot/app event authorization; account-only user grants cannot read profile-wide events.',
            identities: ['bot'], scopes: [], risk: 'read', source: 'service',
            inputSchema: { type: 'object', properties: { cursor: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
        };

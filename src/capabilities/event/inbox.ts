import { inboxDefinition } from './inbox-definition';
export { inboxDefinition } from './inbox-definition';
import { ServiceError } from '../../domain/errors';
import { authorize } from '../../domain/authorization';
import type { Capability } from '../../ports/capabilities';
import type { EventInbox } from '../../ports/events';

export function eventCapability(inbox: Pick<EventInbox, 'read'>): Capability {
    return {
        definition: inboxDefinition,
        preview: async (args) => ({ cursor: args.cursor ?? 0, limit: args.limit ?? 50 }),
        execute: async (args, context) => {
            if (context.selection.identity !== 'bot') throw new ServiceError('FORBIDDEN', 'App inbox events require bot identity. Reconnect with explicit bot event permission.', 403);
            authorize(context.grant, { ...context.selection, domain: 'event', risk: 'read' }, Date.now());
            return inbox.read(context.selection.profileId, Number(args.cursor ?? 0), Number(args.limit ?? 50));
        },
    };
}

import { searchBotCapability } from './search-bot';
import { searchUserCapability } from './search-user';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import { contactDefinitions } from './definitions';

type PreviewContext = Pick<CommandContext, 'selection' | 'grant'>;
function lookup(args: JsonObject, context?: PreviewContext): ApiRequest {
    if (!context) throw new ServiceError('SELECTION_REQUIRED', 'An authorized identity is required to preview this command.');
    const id = args['user-id'];
    if (!id) {
        if (context.selection.identity === 'bot') throw new ServiceError('INVALID_ARGUMENTS', 'Bot identity requires user-id.');
        return { method: 'GET', path: '/open-apis/authen/v1/user_info' };
    }
    const query = { user_id_type: args['user-id-type'] ?? 'open_id' };
    return context.selection.identity === 'bot'
        ? { method: 'GET', path: `/open-apis/contact/v3/users/${encodeURIComponent(String(id))}`, query }
        : { method: 'POST', path: '/open-apis/contact/v3/users/basic_batch', query, body: { user_ids: [id] } };
}
export function contactCapabilities(): Capability[] {
    return [{ definition: contactDefinitions[0]!,
        async preview(args, context) { return lookup(args, context); },
        async execute(args, context) {
            const request = lookup(args, context);
            const data = await context.lark.request(request);
            if (request.method === 'POST') return { user: Array.isArray(data.users) ? data.users[0] ?? {} : {} };
            return { user: args['user-id'] ? data.user ?? data : data };
        },
    }, searchUserCapability(), searchBotCapability()];
}

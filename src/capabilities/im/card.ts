import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
export interface ImCardFormatter {
    format(rawContent: string, mentions: unknown[]): Promise<string>;
}
export async function prepareCards(messages: JsonObject[], formatter?: ImCardFormatter): Promise<JsonObject[]> {
    const output: JsonObject[] = [];
    for (const message of messages) {
        if (message.msg_type !== 'interactive') { output.push(message); continue; }
        if (!formatter) throw new ServiceError('UNAVAILABLE', 'Interactive card conversion is unavailable.', 503);
        const body = message.body && typeof message.body === 'object' ? message.body as JsonObject : {};
        output.push({ ...message, _rendered_content: await formatter.format(String(message.content ?? body.content ?? ''), Array.isArray(message.mentions) ? message.mentions : []) });
    }
    return output;
}

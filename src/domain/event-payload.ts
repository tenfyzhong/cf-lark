import type { JsonObject } from './models';

export function publicEventPayload(payload: JsonObject): JsonObject {
    const { token: _token, ...result } = payload;
    if (result.header && typeof result.header === 'object' && !Array.isArray(result.header)) {
        const { token: _headerToken, ...header } = result.header as JsonObject;
        result.header = header;
    }
    return result;
}

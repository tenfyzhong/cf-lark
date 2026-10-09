import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
export const str = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export const obj = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
export const enc = (value: unknown) => encodeURIComponent(str(value));
export function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
export function resource(value: unknown, field = 'token') { const result = str(value); if (!result || result === '.' || result.includes('..') || /[\s/?#\x00-\x1f]/.test(result)) invalid(`${field} must be a plain resource ID.`); return result; }
export const resourceTypes = ['doc', 'docx', 'sheet', 'bitable', 'file', 'folder', 'wiki', 'mindnote', 'slides', 'minutes', 'apps'];
const prefixes: Record<string, string> = { 'drive/folder': 'folder', doc: 'doc', docx: 'docx', sheets: 'sheet', base: 'bitable', bitable: 'bitable', file: 'file', wiki: 'wiki', mindnote: 'mindnote', mindnotes: 'mindnote', slides: 'slides', minutes: 'minutes', page: 'apps' };
export function target(raw: unknown, explicit: unknown, allowed = resourceTypes, strict = true) {
    let token = str(raw), type = str(explicit).toLowerCase();
    if (token.includes('://')) {
        let url: URL; try { url = new URL(token); } catch { return invalid('Invalid resource URL.'); }
        if (!['https:', 'http:'].includes(url.protocol)) invalid('Unsupported resource URL scheme.');
        const match = url.pathname.match(/^\/(drive\/folder|docx|doc|sheets|base|bitable|file|wiki|mindnotes?|slides|minutes|page)\/([^/]+)(.*)$/);
        if (!match || (strict && match[3] !== '' && match[3] !== '/')) invalid('Unsupported resource URL path.');
        const inferred = prefixes[match[1]!]!;
        if (strict && type && type !== inferred) invalid('type conflicts with the resource URL.');
        type ||= inferred;
        try { token = decodeURIComponent(match[2]!); } catch { return invalid('Invalid token encoding.'); }
    }
    resource(token);
    if (!allowed.includes(type)) invalid('A supported resource type is required.');
    return { token, type };
}

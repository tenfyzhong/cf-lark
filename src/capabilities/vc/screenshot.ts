import { decode } from 'jpeg-js';
import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactStore } from '../../ports/artifacts';
import type { Capability } from '../../ports/capabilities';
import type { LarkTransferClient } from '../../ports/lark';
import { invalid, meetingId, string } from './commands';
import { vcScreenshotDefinition } from './screenshot-definition';
const limit = 8 * 1024 * 1024;
function prepare(args: JsonObject) {
    const id = meetingId(args), name = string(args, 'output');
    if (name.split(/[\\/]/).includes('..') || /[\x00-\x1f]/.test(name)) invalid('Output names cannot contain traversal or control characters.');
    return { id, name: name || `${id}.jpg`, request: { method: 'POST' as const, path: '/open-apis/vc/v1/bots/screenshot', body: { meeting_id: id } } };
}
export function vcScreenshotCapability(artifacts: ArtifactStore): Capability {
    return { definition: vcScreenshotDefinition, preview: async args => ({ requests: [prepare(args).request], output: prepare(args).name }), execute: async (args, context) => {
        const prepared = prepare(args);
        authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
        const response = await (context.lark as LarkTransferClient).download(prepared.request);
        if (response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'image/jpeg') { await response.body?.cancel(); throw new ServiceError('INVALID_RESPONSE', 'Screenshot response must be image/jpeg.', 502); }
        const reader = response.body?.getReader();
        if (!reader) throw new ServiceError('INVALID_RESPONSE', 'Screenshot response has no body.', 502);
        const chunks: Uint8Array[] = []; let size = 0;
        try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > limit) throw new ServiceError('INVALID_RESPONSE', 'Screenshot exceeds 8 MiB.', 502); chunks.push(chunk.value); } }
        catch (error) { await reader.cancel(); throw error; }
        finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        if (size < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[size - 2] !== 255 || bytes[size - 1] !== 217) throw new ServiceError('INVALID_RESPONSE', 'Invalid screenshot JPEG.', 502);
        try { decode(bytes, { useTArray: true, tolerantDecoding: false, maxResolutionInMP: 16, maxMemoryUsageInMB: 48 }); }
        catch { throw new ServiceError('INVALID_RESPONSE', 'Screenshot JPEG is invalid or exceeds the decoded image budget.', 502); }
        const digest = await crypto.subtle.digest('SHA-256', bytes), sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
        const artifact = await artifacts.upload(context.grant.id, size, new Blob([bytes]).stream());
        return { meeting_id: prepared.id, artifact_id: artifact.id, path: artifact.id, name: prepared.name, size_bytes: size, content_type: 'image/jpeg', sha256 };
    } };
}

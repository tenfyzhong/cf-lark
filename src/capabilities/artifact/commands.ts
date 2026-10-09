import { ServiceError } from '../../domain/errors';
import type { ArtifactStore } from '../../ports/artifacts';
import type { Capability } from '../../ports/capabilities';
import { artifactDefinitions } from './definitions';

const inlineLimit = 512 * 1024;
function decode(value: unknown): Uint8Array<ArrayBuffer> {
    if (typeof value !== 'string' || !value || value.length > 699052) throw new ServiceError('INVALID_ARGUMENTS', 'Provide at most 512 KiB as canonical Base64.');
    try {
        const binary = atob(value);
        if (btoa(binary) !== value || binary.length > inlineLimit) throw new Error('Invalid Base64 size or encoding.');
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch { throw new ServiceError('INVALID_ARGUMENTS', 'Provide at most 512 KiB as canonical Base64.'); }
}

export function artifactCapabilities(store: ArtifactStore): Capability[] {
    return artifactDefinitions.map((definition) => ({
        definition,
        preview: async (args) => definition.id === 'artifact.upload'
            ? { operation: 'store', size: decode(args.content).byteLength }
            : { operation: definition.id, id: args.id },
        execute: async (args, context) => {
            const owner = context.grant.id;
            if (definition.id === 'artifact.upload') {
                const bytes = decode(args.content);
                const artifact = await store.upload(owner, bytes.byteLength, new Blob([bytes]).stream());
                return { id: artifact.id, size: artifact.size, expiresAt: artifact.expiresAt };
            }
            if (definition.id === 'artifact.delete') {
                await store.remove(owner, String(args.id));
                return { ok: true };
            }
            const response = await store.read(owner, String(args.id));
            const size = Number(response.headers.get('Content-Length'));
            if (!Number.isSafeInteger(size) || size <= 0 || size > inlineLimit) {
                await response.body?.cancel();
                throw new ServiceError('STREAM_REQUIRED', 'Use authenticated GET /mcp/artifacts/{id} to read this artifact.', 413);
            }
            const reader = response.body?.getReader();
            if (!reader) throw new ServiceError('ARTIFACT_NOT_FOUND', 'The artifact body is unavailable.', 404);
            let binary = '';
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (binary.length + value.length > inlineLimit) throw new ServiceError('STREAM_REQUIRED', 'Use the authenticated streaming endpoint for this artifact.', 413);
                    for (let offset = 0; offset < value.length; offset += 8192) binary += String.fromCharCode(...value.subarray(offset, offset + 8192));
                }
            } finally { await reader.cancel(); }
            return { id: args.id, size: binary.length, content: btoa(binary), encoding: 'base64' };
        },
    }));
}

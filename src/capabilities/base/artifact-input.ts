import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactStore } from '../../ports/artifacts';
import type { Capability } from '../../ports/capabilities';
const jsonFlags = ['json', 'fields', 'view', 'data-config', 'position', 'dsl'];
const maximum = 2 * 1024 * 1024;
function references(args: JsonObject): string[] { return jsonFlags.filter(key => typeof args[key] === 'string' && (args[key] as string).trim().startsWith('@')); }
export function withArtifactInputs(capability: Capability, artifacts?: ArtifactStore): Capability {
    return { ...capability,
        preview: async (args, context) => references(args).length ? { command: capability.definition.id, deferredArtifactValidation: true, artifacts: references(args).map(key => ({ argument: key, id: String(args[key]).trim().slice(1).trim() })), requests: [], note: 'Artifact JSON is validated during execution before any upstream request.' } : capability.preview(args, context),
        execute: async (args, context) => {
            const keys = references(args);
            if (!keys.length) return capability.execute(args, context);
            authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
            if (!artifacts) throw new ServiceError('ARTIFACT_UNAVAILABLE', 'Artifact input is unavailable.', 500);
            const resolved = { ...args };
            for (const key of keys) {
                const id = String(args[key]).trim().slice(1).trim();
                if (!id) throw new ServiceError('INVALID_ARGUMENTS', 'An artifact ID must follow @.');
                const response = await artifacts.read(context.grant.id, id);
                const reader = response.body?.getReader();
                if (!reader) throw new ServiceError('INVALID_ARGUMENTS', 'The JSON artifact is empty.');
                const chunks: Uint8Array[] = []; let size = 0;
                try {
                    for (;;) {
                        const item = await reader.read(); if (item.done) break;
                        size += item.value.byteLength;
                        if (size > maximum) throw new ServiceError('INVALID_ARGUMENTS', 'JSON artifacts must not exceed 2 MiB.');
                        chunks.push(item.value);
                    }
                } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
                const bytes = new Uint8Array(size); let offset = 0;
                for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
                try { const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); const value = JSON.parse(raw); resolved[key] = key === 'dsl' ? raw : value; }
                catch { throw new ServiceError('INVALID_ARGUMENTS', 'The artifact must contain valid UTF-8 JSON.'); }
            }
            return capability.execute(resolved, context);
        },
    };
}

import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles, ArtifactStore } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
import { fileFlags } from './generated/file-flags';
const limit = 20 * 1024 * 1024;
export async function resolveSheetFiles(name: string, input: JsonObject, artifacts?: ArtifactStore, context?: Pick<CommandContext, 'selection' | 'grant'>): Promise<JsonObject> {
    const args = { ...input };
    for (const flag of fileFlags[name] ?? []) {
        const value = args[flag];
        if (typeof value !== 'string' || !value.startsWith('@')) continue;
        if (!context || !artifacts || typeof (artifacts as ArtifactFiles).stat !== 'function') throw new ServiceError('ARTIFACT_UNAVAILABLE', 'File inputs require an authenticated private artifact store.', 503);
        authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
        const id = value.slice(1);
        if (!id) throw new ServiceError('INVALID_ARGUMENTS', 'A private artifact ID must follow @.');
        const file = await (artifacts as ArtifactFiles).stat(context.grant.id, id);
        if (file.size > limit) throw new ServiceError('INVALID_ARGUMENTS', 'Hosted text inputs cannot exceed 20 MiB.');
        const response = await artifacts.read(context.grant.id, id);
        if (!response.body) throw new ServiceError('ARTIFACT_UNAVAILABLE', 'The input artifact has no readable body.');
        const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
        let size = 0, text = '';
        try {
            for (;;) {
                const chunk = await reader.read(); if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > limit) throw new ServiceError('INVALID_ARGUMENTS', 'Hosted text inputs cannot exceed 20 MiB.');
                text += decoder.decode(chunk.value, { stream: true });
            }
            text += decoder.decode();
        } catch (error) { await reader.cancel().catch(() => undefined); if (error instanceof TypeError) throw new ServiceError('INVALID_ARGUMENTS', 'Text input artifacts must contain UTF-8.'); throw error; }
        finally { reader.releaseLock(); }
        args[flag] = text;
    }
    return args;
}

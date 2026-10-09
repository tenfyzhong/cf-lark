import { ServiceError } from '../../domain/errors';
import { authorize } from '../../domain/authorization';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
export const invalid = (message: string): never => { throw new ServiceError('INVALID_ARGUMENTS', message); };
export function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export async function resolveJSON(value: unknown, label: string, context?: CommandContext, artifacts?: ArtifactFiles): Promise<unknown> {
    if (typeof value !== 'string') return value;
    let text = value.trim();
    if (text === '-') invalid(`${label}: stdin is unavailable; use a private artifact.`);
    if (text.startsWith('@')) {
        if (!context || !artifacts) throw new ServiceError('ARTIFACT_INPUT_REQUIRED', `${label} requires artifact hydration.`);
        const id = text.slice(1).replace(/^artifact:/u, '').split('/')[0]!;
        authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
        const metadata = await artifacts.stat(context.grant.id, id);
        if (metadata.size > 2 * 1024 * 1024) invalid(`${label} exceeds the 2 MiB JSON input limit.`);
        const response = await artifacts.read(context.grant.id, id);
        text = new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer());
    }
    if (!text) return undefined;
    try { return JSON.parse(text); } catch { invalid(`${label} must be valid JSON.`); }
}
export interface ApiFile { id: string; name: string; field: string; }
export function parseFile(value: unknown, defaultField = 'file'): ApiFile | undefined {
    if (value === undefined || value === '') return undefined;
    if (object(value)) {
        const id = String(value.id ?? value.artifactId ?? ''), name = String(value.name ?? value.filename ?? ''), field = String(value.field ?? defaultField);
        if (!id || !name || !field || /[\r\n\0"/\\]/u.test(name + field)) invalid('A safe artifact id, filename and multipart field are required.');
        return { id, name, field };
    }
    let text = String(value), field = defaultField;
    const equal = text.indexOf('='); if (equal > 0) { field = text.slice(0, equal); text = text.slice(equal + 1); }
    text = text.replace(/^@/u, '');
    if (!text.startsWith('artifact:')) invalid('file must reference artifact:<id>/<filename>.');
    const [id, ...name] = text.slice(9).split('/');
    return parseFile({ id, name: name.join('/') || 'upload.bin', field });
}

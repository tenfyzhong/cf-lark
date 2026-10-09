import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { WorkflowProgram } from '../../ports/workflows';
import { boundedBlob } from './db-files';
const object = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);
export function envPullRequest(args: JsonObject): ApiRequest {
    if (typeof args['app-id'] !== 'string' || !args['app-id'].trim()) throw new ServiceError('INVALID_ARGUMENTS', 'Cloud environment pull requires an explicit app-id.');
    if (args['project-path']) throw new ServiceError('INVALID_ARGUMENTS', 'Use a file artifact instead of a local project-path.');
    return { method: 'POST', path: `/open-apis/spark/v1/apps/${encodeURIComponent(args['app-id'].trim())}/env_vars`, body: { env: 'dev' } };
}
function quote(value: string) { return JSON.stringify(value).replace(/\u0000/g, '\\x00'); }
export function envPullProgram(artifacts: ArtifactFiles): WorkflowProgram {
    return { id: 'apps-env-pull', version: 1, domain: 'apps', risk: 'write', identities: ['user'], async step(state, context) {
        const args = state.args as JsonObject, request = envPullRequest(args);
        authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
        let original = '';
        if (typeof args.file === 'string' && args.file.trim()) {
            authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
            const meta = await artifacts.stat(context.grant.id, args.file.trim());
            if (meta.size > 1048576) throw new ServiceError('FILE_TOO_LARGE', 'Environment input must not exceed 1 MiB.', 413);
            original = await (await boundedBlob(await artifacts.read(context.grant.id, args.file.trim()))).text();
        }
        const data = await context.lark.request(request), nested = object(data.data) ? data.data : {};
        const raw = data.env_vars ?? data.envVars ?? nested.env_vars ?? nested.envVars;
        if (!object(raw) && !Array.isArray(raw)) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Environment response must contain an object or array.', 502);
        const entries: JsonObject[] = Array.isArray(raw) ? raw.filter(object) : Object.entries(raw).map(([key, value]) => ({ key, value }));
        const vars = new Map<string, string>(); let expiry = '';
        for (const item of entries) {
            if (typeof item.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.key) || typeof item.value !== 'string') continue;
            vars.set(item.key, item.value);
            if (item.key === 'SUDA_DATABASE_URL' && Array.isArray(item.extras)) {
                const found = item.extras.find((extra) => object(extra) && extra.key === 'expiresAt');
                if (object(found) && (typeof found.value === 'number' && Number.isFinite(found.value) || typeof found.value === 'string' && /^[+-]?\d+$/.test(found.value.trim()))) expiry = typeof found.value === 'number' ? String(Math.trunc(found.value)) : String(found.value).trim();
            }
        }
        let content = original;
        if (vars.size) {
            const lines = original.replaceAll('\r\n', '\n').split('\n'); if (lines.at(-1) === '') lines.pop();
            const used = new Set<string>();
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i]!.trim(); if (!line || line.startsWith('#')) continue;
                const assignment = line.replace(/^export[ \t]\s*/, ''), split = assignment.indexOf('='), key = assignment.slice(0, split).trim();
                if (split <= 0 || /[ \t]/.test(key) || !vars.has(key)) continue;
                lines[i] = `${key}=${quote(vars.get(key)!)}`; used.add(key);
            }
            for (const key of [...vars.keys()].filter((key) => !used.has(key)).sort()) lines.push(`${key}=${quote(vars.get(key)!)}`);
            content = lines.join('\n');
        }
        if (content && !content.endsWith('\n')) content += '\n';
        if (!content) content = '\n';
        const blob = new Blob([content]);
        if (blob.size > 1048576) throw new ServiceError('FILE_TOO_LARGE', 'Environment output must not exceed 1 MiB.', 413);
        const artifact = await artifacts.upload(context.grant.id, blob.size, blob.stream());
        return { done: true, output: { app_id: String(args['app-id']).trim(), env_file: artifact.id, artifactId: artifact.id, ...(expiry ? { database_url_expires_at: expiry } : {}) } };
    } };
}

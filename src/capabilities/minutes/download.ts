import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactStore } from '../../ports/artifacts';
import type { Capability } from '../../ports/capabilities';
import type { RemoteFiles } from '../../ports/remote-files';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { minuteTokens } from './read';
import { minutesDownloadDefinition } from './download-definition';
function prepare(args: JsonObject): string[] {
    const tokens = minuteTokens(args);
    if (args.output && args['output-dir']) throw new ServiceError('INVALID_ARGUMENTS', 'output and output-dir cannot both be set.');
    return tokens;
}
export function minutesDownloadCapability(workflows: WorkflowRunner): Capability {
    return { definition: minutesDownloadDefinition, preview: async args => ({ program: 'minutes-download', minute_tokens: prepare(args), requests: [{ method: 'GET', path: '/open-apis/minutes/v1/minutes/{minute_token}/media' }], output: args['url-only'] ? 'Presigned URLs.' : 'Private grant-owned media artifacts.' }), execute: async (args, context) => {
        prepare(args);
        if (args['url-only'] !== true) authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
        return workflows.start('minutes-download', { args, phase: 'url', index: 0, results: [] }, context.selection, context.grant);
    } };
}
export function minutesDownloadProgram(artifacts: ArtifactStore, remote: RemoteFiles): WorkflowProgram {
    return { id: 'minutes-download', version: 1, domain: 'minutes', risk: 'read', identities: ['user', 'bot'], step: async (raw, context) => {
        const state = raw as { args: JsonObject; phase: string; index: number; results: JsonObject[]; url?: string; names?: string[] }, tokens = prepare(state.args), token = tokens[state.index];
        if (!token) return { done: true, output: tokens.length === 1 ? state.results[0] : { downloads: state.results, ...(state.results.every(item => item.error) ? { partial_failure: true } : {}) } };
        if (state.args['url-only'] !== true) authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
        const finish = (result: JsonObject, names = state.names ?? []) => ({ done: false as const, state: { args: state.args, phase: 'url', index: state.index + 1, results: [...state.results, { minute_token: token, ...result }], names } });
        if (state.phase === 'url') {
            const duplicate = tokens.indexOf(token);
            if (duplicate < state.index) return finish({ error: `Duplicate token, same as index ${duplicate}.` });
            try {
                const data = await context.lark.request({ method: 'GET', path: `/open-apis/minutes/v1/minutes/${token}/media` });
                if (typeof data.download_url !== 'string' || !data.download_url) throw new ServiceError('INVALID_RESPONSE', 'Minute media response omitted its download URL.', 502);
                if (state.args['url-only'] === true) return finish({ download_url: data.download_url });
                return { done: false, state: { ...state, phase: 'download', url: data.download_url } };
            } catch (error) { if (!(error instanceof ServiceError)) throw error; if (tokens.length === 1) throw error; return finish({ error: error.message }); }
        }
        try {
            const response = await remote.stream(state.url!, 2_000_000_000);
            const length = response.headers.get('Content-Length'), size = Number(length);
            if (!response.body || (length !== null && (!Number.isSafeInteger(size) || size <= 0)) || (length === null && !artifacts.ingest)) { await response.body?.cancel(); throw new ServiceError('LENGTH_REQUIRED', 'Media download has no usable body or storage cannot reserve unknown-length data.', 411); }
            const disposition = response.headers.get('Content-Disposition') ?? '';
            const supplied = disposition.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
            const basename = (supplied?.[1] ?? supplied?.[2] ?? '').trim().replaceAll('\\', '/').split('/').at(-1) ?? '';
            const type = response.headers.get('Content-Type')?.split(';')[0]?.trim() ?? '';
            const extensions: Record<string, string> = { 'video/mp4': '.mp4', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'video/quicktime': '.mov' };
            let name = tokens.length === 1 && state.args.output ? String(state.args.output) : basename && basename !== '.' && basename !== '..' ? basename : token + (extensions[type] ?? '.media');
            if ((state.names ?? []).includes(name)) name = `${token}-${name}`;
            const artifact = length === null ? await artifacts.ingest!(context.grant.id, 2_000_000_000, response.body) : await artifacts.upload(context.grant.id, size, response.body);
            return finish({ artifact_type: 'recording', artifact_id: artifact.id, saved_path: artifact.id, name, size_bytes: artifact.size }, [...(state.names ?? []), name]);
        } catch (error) { if (!(error instanceof ServiceError)) throw error; if (tokens.length === 1) throw error; return finish({ error: error.message }); }
    } };
}

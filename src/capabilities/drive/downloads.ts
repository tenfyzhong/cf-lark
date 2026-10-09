import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactStore } from '../../ports/artifacts';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { ApiRequest, LarkTransferClient } from '../../ports/lark';
import { saveDownloadResponse } from '../files/index';
import { driveDownloadDefinitions } from './download-definitions';
import { enc, invalid, obj, resource, str, target } from './helpers';
import { previewStatuses, previewTypes } from './preview-data';
const covers: Record<string, { label: string; description: string; query: JsonObject }> = {
    default: { label: 'Default Cover', description: 'Standard large cover (1280x1280).', query: { bus_type: 'cover', platform: 'pc' } },
    icon: { label: 'Icon', description: 'Small list icon (120x120).', query: { bus_type: 'icon' } },
    grid: { label: 'Grid Cover', description: 'Grid/card stream cover (360x360).', query: { bus_type: 'grid' } },
    small: { label: 'Small Graph', description: 'PC small graph cover (480x480).', query: { bus_type: 'small_graph', platform: 'pc' } },
    middle: { label: 'Middle Cover', description: 'Medium-sized cover (720x720).', query: { bus_type: 'middle' } },
    big: { label: 'Big Cover', description: 'Large mobile-oriented cover (850x850).', query: { bus_type: 'big', platform: 'mobile' } },
    square: { label: 'Square Cover', description: 'Square-cropped grid cover (360x360).', query: { width: 360, height: 360, policy: 'near' } },
};
const mimeExtensions: Record<string, string> = { 'application/json': '.json', 'application/msword': '.doc', 'application/pdf': '.pdf', 'application/xml': '.xml', 'application/zip': '.zip', 'image/bmp': '.bmp', 'image/gif': '.gif', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/svg+xml': '.svg', 'image/webp': '.webp', 'text/csv': '.csv', 'text/html': '.html', 'text/markdown': '.md', 'text/plain': '.txt', 'text/x-markdown': '.md', 'text/xml': '.xml', 'video/mp4': '.mp4' };
const first = (row: JsonObject, keys: string[]) => { for (const key of keys) { const value = row[key]; if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim(); } return ''; };
function fileSource(args: JsonObject) {
    if (['file-token', 'url', 'wiki-token'].filter((key) => str(args[key])).length !== 1) invalid('Exactly one of file-token, url or wiki-token is required.');
    if (args.url) { const source = target(args.url, '', ['file', 'wiki']); return { token: source.token, wiki: source.type === 'wiki' }; }
    return { token: resource(args['file-token'] || args['wiki-token']), wiki: Boolean(args['wiki-token']) };
}
function validate(action: string, args: JsonObject) {
    if (['download', 'preview'].includes(action)) fileSource(args); else resource(args['file-token'], 'file-token');
    if (action === 'version-get' && !/^\d{1,19}$/.test(str(args.version))) invalid('version must contain 1 to 19 decimal digits.');
    if (action === 'preview' || action === 'cover') {
        const key = action === 'cover' ? 'spec' : 'type';
        if (args['list-only'] ? Boolean(str(args[key]) || str(args.output)) : !str(args[key]) || !str(args.output)) invalid(`Use list-only alone, or ${key} together with output.`);
        if (str(args['if-exists']) && !['error', 'overwrite', 'rename'].includes(str(args['if-exists']))) invalid('Unsupported if-exists policy.');
        if (action === 'cover' && str(args.spec) && !covers[str(args.spec).toLowerCase()]) invalid('Unknown cover preset.');
    }
}
export async function resolveFileSource(args: JsonObject, context: CommandContext) {
    const source = fileSource(args), warnings: string[] = []; let info: JsonObject = {};
    try {
        info = await context.lark.request({ method: 'GET', path: '/open-apis/drive/v2/files/query_by_token', query: { token: source.token } });
        if (!str(info.obj_token) || !str(info.obj_type)) throw new ServiceError('INVALID_RESPONSE', 'Entity lookup omitted object metadata.');
        resource(info.obj_token);
    } catch {
        warnings.push('Token lookup failed; using the original file resolution.');
        if (source.wiki) {
            info = obj((await context.lark.request({ method: 'GET', path: '/open-apis/wiki/v2/spaces/get_node', query: { token: source.token } })).node);
            if (!str(info.obj_token) || !str(info.obj_type)) throw new ServiceError('INVALID_RESPONSE', 'Wiki lookup omitted object metadata.');
            info.is_wiki_token = true;
        } else info = { obj_token: source.token, obj_type: 'file' };
    }
    if (info.obj_type !== 'file') invalid('This resource is an online document; use drive.+export instead.');
    resource(info.obj_token);
    return { token: str(info.obj_token), annotation: { ...(warnings.length ? { warnings } : {}), ...(info.is_wiki_token ? { wiki_token: source.token, wiki_node: { obj_token: info.obj_token, obj_type: info.obj_type } } : {}) } };
}
export function downloadFilename(response: Response, preferred: string, fallback: string, extension = '') {
    const disposition = response.headers.get('Content-Disposition') || '';
    let headerName = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
    if (headerName) { try { headerName = decodeURIComponent(headerName); } catch { headerName = undefined; } }
    headerName ||= disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1] || disposition.match(/filename\s*=\s*([^;]+)/i)?.[1];
    let name = (preferred || headerName || fallback).trim().split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g, '') || 'download';
    if (name === '.' || name === '..') name = fallback || 'download';
    if (!/\.[^.]+$/.test(name)) name += mimeExtensions[(response.headers.get('Content-Type') || '').split(';')[0]!.trim().toLowerCase()] || extension;
    return name;
}
export function previewCandidates(data: JsonObject) {
    return (Array.isArray(data.preview_results) ? data.preview_results : []).filter((row) => row && typeof row === 'object' && !Array.isArray(row)).map((raw) => {
        const row = obj(raw), typeCode = first(row, ['preview_type', 'type_code', 'type']), statusCode = first(row, ['preview_status', 'status_code', 'status']);
        const type = previewTypes.find((value) => value.code === typeCode), status = previewStatuses.find((value) => value.code === statusCode);
        const reason = status?.downloadable ? '' : first(row, ['reason', 'status_msg', 'message', 'msg', 'detail']) || status?.reason || (statusCode ? `Unknown preview status ${statusCode}.` : 'Preview status is missing.');
        return { type: type?.type || (typeCode ? `unknown_${typeCode}` : 'unknown'), type_code: typeCode, label: type?.label || `Unknown Preview Type${typeCode ? ` ${typeCode}` : ''}`, status: status?.name || 'UNKNOWN', status_code: statusCode, downloadable: status?.downloadable || false, ...(reason ? { reason } : {}) };
    });
}
function chooseCandidate(candidates: ReturnType<typeof previewCandidates>, requested: string) {
    const key = requested.toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
    const exact = candidates.find((candidate) => candidate.type === key || candidate.type_code === key);
    const aliases = candidates.filter((candidate) => previewTypes.find((type) => type.code === candidate.type_code)?.aliases.includes(key));
    const candidate = exact || aliases.find((value) => value.downloadable) || aliases[0];
    if (!candidate) throw new ServiceError('PREVIEW_UNAVAILABLE', 'The requested preview type is unavailable.', 412, { candidates });
    if (!candidate.downloadable) throw new ServiceError('PREVIEW_NOT_READY', 'The selected preview is not ready.', 412, { candidate });
    return candidate;
}
function coverList(token: string) { return { mode: 'list', file_token: token, candidates: Object.entries(covers).map(([spec, value]) => ({ spec, label: value.label, description: value.description })), next_action: 'select one spec and rerun with --spec plus --output' }; }
export function driveDownloadCapabilities(artifacts: ArtifactStore): Capability[] {
    return driveDownloadDefinitions.map((definition) => {
        const action = definition.id.slice('drive.+'.length);
        return { definition,
            async preview(args) {
                validate(action, args);
                if (action === 'cover' && args['list-only']) return { requests: [], ...coverList(str(args['file-token'])) };
                const source = ['download', 'preview'].includes(action) ? fileSource(args) : { token: str(args['file-token']), wiki: false };
                const requests: ApiRequest[] = ['download', 'preview'].includes(action) ? [{ method: 'GET', path: '/open-apis/drive/v2/files/query_by_token', query: { token: source.token } }] : [];
                if (source.wiki) requests.push({ method: 'GET', path: '/open-apis/wiki/v2/spaces/get_node', query: { token: source.token } });
                if (action === 'download') requests.push({ method: 'GET', path: `/open-apis/drive/v1/permissions/${enc(source.token)}/members/auth`, query: { type: 'file', action: 'export' } });
                if (action === 'preview' && args.type !== 'source_file') requests.push({ method: 'POST', path: `/open-apis/drive/v1/medias/${enc(source.token)}/preview_result`, body: args.version ? { version: args.version } : {} });
                if (action === 'download' && !str(args.output)) requests.push({ method: 'POST', path: '/open-apis/drive/v1/metas/batch_query', body: { request_docs: [{ doc_token: '{resolved_file_token}', doc_type: 'file' }], with_url: true } });
                if (!args['list-only']) {
                    const token = ['download', 'preview'].includes(action) ? '{resolved_file_token}' : source.token;
                    const query: JsonObject = action === 'cover' ? { preview_type: '1', ...covers[str(args.spec).toLowerCase()]!.query } : action === 'preview' ? { preview_type: args.type === 'source_file' ? '16' : '{selected_preview_type}', ...(args.type !== 'source_file' && !args.version ? { version: '{resolved_preview_version}' } : {}) } : {};
                    if (args.version) query.version = args.version;
                    const path = action === 'export-download' ? `/open-apis/drive/v1/export_tasks/file/${enc(token)}/download` : action === 'preview' || action === 'cover' ? `/open-apis/drive/v1/medias/${enc(token)}/preview_download` : `/open-apis/drive/v1/files/${enc(token)}/download`;
                    requests.push({ method: 'GET', path, ...(Object.keys(query).length ? { query } : {}) });
                }
                return { requests, download: !args['list-only'], output: args.output || args['file-name'], artifact: 'A new immutable private artifact is allocated for every download.' };
            },
            async execute(args, context) {
                validate(action, args);
                if (action === 'cover' && args['list-only']) return coverList(str(args['file-token']));
                const resolved = ['download', 'preview'].includes(action) ? await resolveFileSource(args, context) : { token: str(args['file-token']), annotation: {} };
                const token = resolved.token, transfer = context.lark as LarkTransferClient;
                let query: JsonObject = {}, path = `/open-apis/drive/v1/files/${enc(token)}/download`, selected = '', fallback = token, extension = '';
                if (action === 'download') {
                    try { const result = await context.lark.request({ method: 'GET', path: `/open-apis/drive/v1/permissions/${enc(token)}/members/auth`, query: { type: 'file', action: 'export' } }); if (typeof result.auth_result !== 'boolean') throw new ServiceError('INVALID_RESPONSE', 'Export permission check omitted auth_result.'); if (!result.auth_result) throw new ServiceError('FORBIDDEN', 'The selected identity cannot export this file.', 403); }
                    catch (error) { if (!(error instanceof ServiceError) || ![99991672, 99991679, 99991676].includes(Number(error.details?.upstreamCode))) throw error; }
                    if (!str(args.output)) { try { const data = await context.lark.request({ method: 'POST', path: '/open-apis/drive/v1/metas/batch_query', body: { request_docs: [{ doc_token: token, doc_type: 'file' }], with_url: true } }); fallback = str(obj(Array.isArray(data.metas) ? data.metas[0] : {}).title) || token; } catch (error) { if (error instanceof ServiceError && [401, 403].includes(error.status)) throw error; } }
                } else if (action === 'version-get') query = { version: args.version };
                else if (action === 'export-download') path = `/open-apis/drive/v1/export_tasks/file/${enc(token)}/download`;
                else {
                    path = `/open-apis/drive/v1/medias/${enc(token)}/preview_download`;
                    if (action === 'cover') { selected = str(args.spec).toLowerCase(); query = { preview_type: '1', ...covers[selected]!.query }; extension = '.png'; }
                    else if (args.type === 'source_file') { selected = 'source_file'; query = { preview_type: '16' }; }
                    else {
                        const data = await context.lark.request({ method: 'POST', path: `/open-apis/drive/v1/medias/${enc(token)}/preview_result`, body: args.version ? { version: args.version } : {} });
                        const candidates = previewCandidates(data);
                        if (args['list-only']) return { mode: 'list', file_token: token, candidates, ...(candidates.length ? { next_action: 'select one candidate and rerun with --type plus --output' } : {}), ...resolved.annotation };
                        const candidate = chooseCandidate(candidates, str(args.type)); selected = candidate.type; query = { preview_type: candidate.type_code, ...(data.version !== undefined && String(data.version) ? { version: String(data.version) } : {}) };
                        extension = selected.startsWith('pdf') ? '.pdf' : selected.includes('png') ? '.png' : selected.includes('jpg') ? '.jpg' : selected === 'text' ? '.txt' : selected === 'html' ? '.html' : selected.startsWith('mp4') ? '.mp4' : '';
                    }
                    if (args.version) query.version = args.version;
                }
                let response: Response;
                try { response = await transfer.download({ path, ...(Object.keys(query).length ? { query } : {}) }); } catch (error) { if (action === 'cover' && error instanceof ServiceError && error.status === 404) throw new ServiceError('PREVIEW_UNAVAILABLE', 'No artifact exists for this cover preset, token or version.', 412); throw error; }
                const preferred = str(args.output) || str(args['file-name']);
                const filename = downloadFilename(response, preferred.endsWith('/') || preferred.endsWith('\\') ? '' : preferred, fallback, extension);
                const saved = await saveDownloadResponse(artifacts, context, response, filename);
                return { ...saved, file_token: token, ...(args.version ? { version: args.version } : {}), ...(selected ? { mode: 'download', [action === 'cover' ? 'selected_spec' : 'selected_type']: selected } : {}), ...resolved.annotation };
            },
        };
    });
}

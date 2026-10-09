import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ApiRequest } from '../../ports/lark';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { WorkflowProgram } from '../../ports/workflows';
const object = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => typeof v === 'string' ? v : '';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
export function syncRequest(name: string, args: JsonObject, preview: boolean): ApiRequest {
    const app = text(args['app-id']).trim(), env = text(args.environment).trim(), create = name === 'db-sync-create', dry = create && args.preview === true;
    if (!app || 'env' in args || env && !['dev', 'online'].includes(env)) invalid('Provide app-id and a valid environment.');
    let cfg: unknown; try { cfg = JSON.parse(text(args.config)); } catch { invalid('config must contain one JSON object.'); }
    if (!object(cfg)) invalid('config must be an object.');
    if ('field_map' in cfg || 'option_mapping' in cfg) invalid('Use field_maps and option_mappings.');
    if (!['batch', 'streaming'].includes(text(cfg.mode))) invalid('config.mode must be batch or streaming.');
    if (!object(cfg.source) || cfg.source.type !== 'base') invalid('config.source.type must be base.');
    if (!object(cfg.target) || cfg.target.type !== 'postgresql' || !object(cfg.target.table)) invalid('config.target must contain a postgresql table.');
    const table = cfg.target.table;
    if (!text(table.name).trim() || !['create', 'use_existing'].includes(text(table.action))) invalid('Target table requires name and action create or use_existing.');
    if (cfg.schema_only === true && (cfg.mode !== 'batch' || table.action !== 'create')) invalid('schema_only requires batch mode and create action.');
    if ('field_maps' in cfg && !Array.isArray(cfg.field_maps)) invalid('field_maps must be an array.');
    const maps = cfg.field_maps as unknown[] | undefined;
    if (!dry && (maps?.length ? !maps.some((m) => object(m) && m.enabled !== false) : !create)) invalid('At least one mapping must be enabled.');
    if (maps?.some((m) => object(m) && 'option_mapping' in m)) invalid('Use option_mappings in field_maps.');
    if (create) {
        let hasTable = object(cfg.source.table) && !!text(cfg.source.table.name).trim();
        try { hasTable ||= !!new URL(text(cfg.source.base_url), 'https://placeholder.invalid').searchParams.get('table')?.trim(); } catch { /* Invalid URLs cannot identify a table. */ }
        if (!hasTable) invalid('Source requires table.name or a base_url table query parameter.');
    }
    const output = text(args.output).trim();
    if (output && (output.startsWith('/') || output.split(/[\\/]/).includes('..') || /[\p{Cc}]/u.test(output))) invalid('output must be a safe relative filename.');
    const task = text(args['task-id']).trim(); if (!create && !task) invalid('task-id must not be blank.');
    if (!preview && !dry && args.yes !== true) throw new ServiceError('CONFIRMATION_REQUIRED', 'Explicit yes=true is required.');
    return { method: create ? 'POST' : 'PUT', path: `/open-apis/spark/v1/apps/${encodeURIComponent(app)}/db/sync_${create ? 'create' : 'update'}`, body: { config: cfg, ...(create ? { preview: dry } : { task_id: task }), ...(env ? { env } : {}) } };
}
export function syncPreviewProgram(artifacts: ArtifactFiles): WorkflowProgram {
    return { id: 'apps-db-sync-create', version: 1, domain: 'apps', risk: 'write', identities: ['user'], async step(state, context) {
        const args = state.args as JsonObject, request = syncRequest('db-sync-create', args, false);
        if (args.preview !== true) invalid('This artifact workflow requires preview=true.');
        authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
        const data = await context.lark.request(request);
        if (!object(data.config)) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Preview response has no config object to save.', 502);
        const blob = new Blob([`${JSON.stringify(data.config, null, 2)}\n`]), artifact = await artifacts.upload(context.grant.id, blob.size, blob.stream());
        return { done: true, output: { ...data, output: artifact.id, artifactId: artifact.id } };
    } };
}

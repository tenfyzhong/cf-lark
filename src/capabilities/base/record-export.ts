import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
import { authorize } from '../../domain/authorization';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
export interface BaseRecordFormatter { process(input: JsonObject): Promise<unknown>; }
export async function exportRecords(pages: JsonObject[], args: JsonObject, action: string, offset: number, limit: number, context: CommandContext, artifacts?: ArtifactFiles, formatter?: BaseRecordFormatter): Promise<JsonObject> {
    authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
    if (!artifacts || !formatter) throw new ServiceError('UNAVAILABLE', 'Record export storage or formatter is unavailable.', 503);
    const filename = String(args.output ?? `${args['table-id']}_${Date.now()}.ndjson`).split(/[/\\]/u).at(-1)!;
    const manifestName = filename.replace(/\.ndjson$/u, '.manifest.json');
    if (action === 'get' && pages[0]) pages = [{ ...pages[0], query_context: { ...(pages[0].query_context as JsonObject ?? {}), record_scope: 'selected_record_ids', requested_record_count: limit } }, ...pages.slice(1)];
    const result = await formatter.process({ operation: 'export', pages, options: { BaseToken: args['base-token'], TableID: args['table-id'], Offset: offset, RequestedLimit: action === 'get' ? 0 : limit, RecordFile: filename, ManifestFile: manifestName } }) as { ndjson: string; manifest: JsonObject; records: unknown[] };
    const bytes = new TextEncoder().encode(result.ndjson);
    const record = await artifacts.upload(context.grant.id, bytes.length, new Blob([bytes]).stream());
    const recordPath = `/artifacts/${record.id}`;
    const manifest = { ...result.manifest, record_file: recordPath, record_filename: filename, manifest_filename: manifestName };
    let saved;
    try { const encoded = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n'); saved = await artifacts.upload(context.grant.id, encoded.length, new Blob([encoded]).stream()); }
    catch (error) { await artifacts.remove(context.grant.id, record.id).catch(() => {}); throw error; }
    const metadata: JsonObject = { record_file: recordPath, record_artifact_id: record.id, record_file_size_bytes: bytes.length, manifest_file: `/artifacts/${saved.id}`, manifest_artifact_id: saved.id, records_count: result.manifest.records_count, has_more: result.manifest.has_more };
    if (args['jq-records']) return { ...metadata, jq_records: await formatter.process({ operation: 'jq', expression: args['jq-records'], input: result.records }) };
    return args['minimal-stdout'] ? metadata : { ...manifest, ...metadata };
}

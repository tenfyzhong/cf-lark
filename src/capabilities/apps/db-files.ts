import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { LarkTransferClient } from '../../ports/lark';
import type { WorkflowProgram } from '../../ports/workflows';
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
export async function boundedBlob(response: Response, maxBytes = 1048576): Promise<Blob> {
    if (!response.ok || !response.body) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'File response was unsuccessful or empty.', 502);
    const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
    try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > maxBytes) throw new ServiceError('FILE_TOO_LARGE', `File exceeds ${maxBytes} bytes.`, 413); parts.push(next.value); } } finally { await reader.cancel(); }
    return new Blob(parts as BlobPart[]);
}
export function databaseFilePreview(name: string, args: JsonObject): JsonObject {
    const app = text(args['app-id']), env = text(args.environment), importing = name === 'db-data-import';
    if (!app || 'env' in args || env && !['dev', 'online'].includes(env)) throw new ServiceError('INVALID_ARGUMENTS', 'Provide app-id and a valid environment.');
    const filename = importing ? text(args.name) || text(args.file) : text(args.output) || `${text(args.table)}.csv`;
    if (!filename || /[\p{Cc}]/u.test(filename) || filename.startsWith('/') || filename.split(/[\\/]/).includes('..')) throw new ServiceError('INVALID_ARGUMENTS', 'Provide a safe filename.');
    if (importing && /[\\/]/.test(filename)) throw new ServiceError('INVALID_ARGUMENTS', 'Import name must be a filename.');
    const format = filename.split('.').length > 1 ? filename.split('.').at(-1)!.toLowerCase() : '';
    if (!(importing ? ['csv', 'json'] : ['csv', 'json', 'sql']).includes(format)) throw new ServiceError('INVALID_ARGUMENTS', 'Unsupported data file extension.');
    const table = text(args.table) || (importing ? filename.slice(0, -(format.length + 1)) : '');
    if (!table || importing && !text(args.file)) throw new ServiceError('INVALID_ARGUMENTS', 'A table and input artifact are required.');
    const limit = args.limit ?? 5000;
    if (!importing && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 5000)) throw new ServiceError('INVALID_ARGUMENTS', 'limit must be between 1 and 5000.');
    return { method: importing ? 'POST' : 'GET', path: `/open-apis/spark/v1/apps/${encodeURIComponent(app)}/db/data_${importing ? 'import' : 'export'}`, query: { ...(env ? { env } : {}), table, ...(!importing ? { format, limit } : {}) }, filename, format, ...(importing ? { body: { file_name: filename, file: '<artifact contents>' } } : {}) };
}
export function databaseFilePrograms(artifacts: ArtifactFiles): WorkflowProgram[] {
    return ['db-data-import', 'db-data-export'].map((name): WorkflowProgram => ({ id: `apps-${name}`, version: 1, domain: 'apps', risk: name.endsWith('import') ? 'write' : 'read', identities: ['user'], async step(state, context) {
        const args = state.args as JsonObject, preview = databaseFilePreview(name, args), importing = name.endsWith('import'), query = preview.query as JsonObject;
        if (importing && args.yes !== true) throw new ServiceError('CONFIRMATION_REQUIRED', 'Explicit yes=true is required.');
        authorize(context.grant, { ...context.selection, domain: 'artifact', risk: importing ? 'read' : 'write' }, Date.now());
        const lark = context.lark as LarkTransferClient;
        if (importing) {
            const file = text(args.file), metadata = await artifacts.stat(context.grant.id, file);
            if (metadata.size > 1048576) throw new ServiceError('FILE_TOO_LARGE', 'Import files may contain at most 1 MiB.', 413);
            const body = await boundedBlob(await artifacts.read(context.grant.id, file));
            const data = await lark.upload({ path: String(preview.path), query, fields: { file_name: String(preview.filename) }, file: { field: 'file', name: String(preview.filename), body } });
            return { done: true, output: { file, table: text(data.table) || query.table, rows: typeof data.rows === 'number' ? Math.trunc(data.rows) : 0 } };
        }
        if (state.phase === 'prepare') {
            let total: number | null = null;
            try { const data = await lark.request({ method: 'GET', path: String(preview.path).replace('/db/data_export', `/tables/${encodeURIComponent(String(query.table))}/records`), query: { page_size: 1, ...(query.env ? { env: query.env } : {}) } }); total = Number.isFinite(Number(data.total)) ? Math.trunc(Number(data.total)) : 0; } catch { /* A failed count query falls back to the exported content. */ }
            return { done: false, state: { args, phase: 'download', total } };
        }
        if (state.phase !== 'download') throw new ServiceError('INVALID_ARGUMENTS', 'Invalid export workflow phase.');
        const blob = await boundedBlob(await lark.download({ path: String(preview.path), query }));
        const raw = await blob.text(); let rows = 0;
        if (state.total !== null) rows = Math.min(Number(state.total), Number(query.limit));
        else if (preview.format === 'csv') rows = Math.max(0, raw.split('\n').filter((line) => line.replace(/\r+$/, '') !== '').length - 1);
        else try { const parsed = JSON.parse(raw); rows = Array.isArray(parsed) ? parsed.length : parsed && typeof parsed === 'object' ? 1 : 0; } catch { /* Non-JSON SQL has no reliable fallback count. */ }
        const artifact = await artifacts.upload(context.grant.id, blob.size, blob.stream());
        return { done: true, output: { table: query.table, output: artifact.id, artifactId: artifact.id, format: preview.format, rows, size_bytes: artifact.size } };
    } }));
}

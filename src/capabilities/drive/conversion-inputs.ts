import type { JsonObject } from '../../domain/models';
import { invalid, resource, str, target } from './helpers';
const exportFormats: Record<string, string[]> = { doc: ['docx', 'pdf'], docx: ['docx', 'pdf', 'markdown'], sheet: ['xlsx', 'csv'], bitable: ['xlsx', 'csv', 'base'], slides: ['pptx', 'pdf'] };
export function exportInput(args: JsonObject): JsonObject {
    if (Boolean(str(args.url)) === Boolean(str(args.token))) invalid('Exactly one of url or token is required.');
    const raw = str(args.url || args.token), explicit = str(args['doc-type']).toLowerCase();
    if (args.url && !raw.includes('://')) invalid('url must be a supported document URL.');
    const source = target(raw, raw.includes('://') ? '' : explicit, [...Object.keys(exportFormats), 'wiki']);
    if (source.type !== 'wiki' && explicit && explicit !== source.type) invalid('doc-type conflicts with the URL.');
    const type = source.type === 'wiki' ? explicit === 'wiki' ? '' : explicit : source.type;
    const result = { ...args, token: source.token, 'doc-type': type, 'file-extension': str(args['file-extension']).toLowerCase(), ...(source.type === 'wiki' ? { wiki_token: source.token } : {}) };
    validateExportFormat(result);
    return result;
}
export function validateExportFormat(args: JsonObject) {
    const type = str(args['doc-type']), extension = str(args['file-extension']);
    if (!['docx', 'pdf', 'xlsx', 'csv', 'markdown', 'base', 'pptx'].includes(extension)) invalid('Unsupported export extension.');
    if (type && !exportFormats[type]?.includes(extension)) invalid('The export format is incompatible with the document type.');
    if (args['only-schema'] && (extension !== 'base' || (type && type !== 'bitable'))) invalid('only-schema requires bitable base export.');
    if (str(args['sub-id'])) { resource(args['sub-id'], 'sub-id'); if (extension !== 'csv' || (type && !['sheet', 'bitable'].includes(type))) invalid('sub-id is only supported for sheet or bitable CSV exports.'); }
    if (type && ['sheet', 'bitable'].includes(type) && extension === 'csv' && !str(args['sub-id'])) invalid('CSV export requires sub-id.');
}
const importFormats: Record<string, string[]> = { docx: ['docx'], doc: ['docx'], txt: ['docx'], md: ['docx'], mark: ['docx'], markdown: ['docx'], html: ['docx'], xlsx: ['sheet', 'bitable'], xls: ['sheet'], csv: ['sheet', 'bitable'], base: ['bitable'], pptx: ['slides'] };
export function importInput(args: JsonObject): JsonObject {
    resource(args.file, 'file');
    const name = str(args['file-name'] || args.file), extension = name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() || '', type = str(args.type).toLowerCase();
    if (!name || /[\x00-\x1f/\\]/.test(name)) invalid('file-name must be a safe source filename.');
    if (!importFormats[extension]?.includes(type)) invalid('file-name extension is missing or incompatible with the import type.');
    if (str(args['folder-token'])) resource(args['folder-token'], 'folder-token');
    if (str(args['target-token'])) { if (type !== 'bitable') invalid('target-token is only supported for bitable imports.'); resource(args['target-token'], 'target-token'); }
    return { ...args, type, sourceName: name, extension, targetName: str(args.name) || name.slice(0, -(extension.length + 1)) };
}
export function validateImportSize(args: JsonObject, size: number) {
    const extension = str(args.extension);
    const mib = ['doc', 'docx'].includes(extension) ? 600 : extension === 'pptx' ? 500 : extension === 'xlsx' ? 800 : extension === 'csv' && args.type === 'bitable' ? 100 : 20;
    if (!Number.isSafeInteger(size) || size <= 0 || size > mib * 1024 * 1024) invalid(`The source file must be nonempty and no larger than ${mib} MiB for this format.`);
}
export function exportName(preferred: unknown, token: unknown, extension: unknown) {
    let name = str(preferred).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || str(token);
    if (/^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
    const suffix = extension === 'markdown' ? '.md' : `.${str(extension)}`;
    if (!name.toLowerCase().endsWith(suffix)) name += suffix;
    return name;
}

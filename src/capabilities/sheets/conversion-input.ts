import type { JsonObject } from '../../domain/models';
import { ServiceError } from '../../domain/errors';
export function workbookConversionInput(name: string, args: JsonObject, token: string): JsonObject {
    const invalid = (message: string): never => { throw new ServiceError('INVALID_ARGUMENTS', message); };
    if (name === 'workbook-export') {
        const extension = args['file-extension'] || 'xlsx';
        if (!['xlsx', 'csv'].includes(String(extension))) invalid('Workbook exports support xlsx or csv.');
        if (extension === 'csv' && !args['sheet-id']) invalid('CSV exports require sheet-id.');
        if (token.startsWith('fake_office_') || token.startsWith('local_office_') || (token.length >= 25 && [4, 9, 14, 19, 24].map(n => token[n]).join('') === 'OFL0X')) invalid('Office files cannot be exported as native spreadsheets. Download the stored file or import it first.');
        return { token, 'doc-type': 'sheet', 'file-extension': extension, ...(args['sheet-id'] ? { 'sub-id': args['sheet-id'] } : {}), ...(args['output-path'] ? { 'file-name': String(args['output-path']).split('/').pop(), overwrite: true } : { 'skip-download': true }) };
    }
    if (typeof args.file !== 'string' || !args.file.trim()) invalid('file must reference a private artifact.');
    const fileName = String(args['file-name'] || args.file);
    if (!/\.(csv|xls|xlsx)$/i.test(fileName) || /[\r\n\0/\\]/.test(fileName)) invalid('file-name must be a safe xls, xlsx, or csv filename.');
    return { file: args.file, 'file-name': fileName, type: 'sheet', ...(args.name ? { name: args.name } : {}), ...(args['folder-token'] ? { 'folder-token': args['folder-token'] } : {}) };
}

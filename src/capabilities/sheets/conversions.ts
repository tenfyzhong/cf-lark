import type { ArtifactFiles, ArtifactStore } from '../../ports/artifacts';
import type { WorkflowProgram } from '../../ports/workflows';
import type { JsonObject } from '../../domain/models';
import { conversionProgram } from '../drive/conversions';
import { ServiceError } from '../../domain/errors';
import { authorize } from '../../domain/authorization';
export function workbookConversionPrograms(artifacts?: ArtifactStore): WorkflowProgram[] {
    return ['import', 'export'].map(action => ({ id: `sheets-workbook-${action}`, domain: 'sheets', version: 1, risk: action === 'import' ? 'write' : 'read', identities: ['user', 'bot'],
        step: async (state, context) => {
            if (!artifacts || typeof (artifacts as ArtifactFiles).stat !== 'function') throw new ServiceError('ARTIFACT_UNAVAILABLE', 'Artifact storage is not configured.', 503);
            const args = state.args as JsonObject;
            if (action === 'import' && state.phase === 'start' && !state.sniffed) {
                authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
                const originalName = String(args['file-name']), extension = originalName.split('.').pop()!.toLowerCase();
                if (['xls', 'xlsx'].includes(extension)) {
                    const stat = await (artifacts as ArtifactFiles).stat(context.grant.id, String(args.file));
                    const response = await artifacts.read(context.grant.id, String(args.file), { offset: 0, length: Math.min(8, stat.size) });
                    const bytes = new Uint8Array(await response.arrayBuffer());
                    if (bytes.length < 4) return { done: false, state: { ...state, sniffed: true } };
                    const actual = bytes[0] === 0x50 && bytes[1] === 0x4b ? 'xlsx' : [0xd0, 0xcf, 0x11, 0xe0].every((v, n) => bytes[n] === v) ? 'xls' : '';
                    if (!actual) throw new ServiceError('INVALID_ARGUMENTS', 'The Excel file is neither an XLS nor XLSX container.');
                    if (actual !== extension) return { done: false, state: { ...state, sniffed: true, args: { ...args, 'file-name': originalName.replace(/\.[^.]+$/, `.${actual}`) }, inputCorrections: [{ field: 'file_extension', declared: extension, actual, reason: `${originalName} is named .${extension} but its content is a .${actual} workbook; imported as .${actual}` }] } };
                }
                return { done: false, state: { ...state, sniffed: true } };
            }
            const program = conversionProgram(artifacts as ArtifactFiles, { action: action as 'import' | 'export', id: `sheets-workbook-${action}`, domain: 'sheets' });
            const result = await program.step(state, context);
            return result.done && state.inputCorrections ? { done: true, output: { ...(result.output as JsonObject), input_corrections: state.inputCorrections } } : result;
        },
    }));
}

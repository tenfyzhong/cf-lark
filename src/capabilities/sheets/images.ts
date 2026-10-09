import { scanImageMetadata } from './image-metadata';
import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { ArtifactFiles, ArtifactStore } from '../../ports/artifacts';
import type { JsonObject } from '../../domain/models';
import type { WorkflowProgram } from '../../ports/workflows';
import { uploadPrograms } from '../files/upload-programs';
import { invokeSheetTool } from './commands';
export function sheetImageParent(token: string): string {
    return token.startsWith('fake_office_') || token.startsWith('local_office_') || (token.length >= 25 && [4, 9, 14, 19, 24].map(n => token[n]).join('') === 'OFL0X') ? 'office_sheet_file' : 'sheet_image';
}
export function imageProgram(artifacts?: ArtifactStore): WorkflowProgram {
    return { id: 'sheets-image', version: 1, domain: 'sheets', risk: 'write', identities: ['user', 'bot'],
        step: async (state, context) => {
            if (state.phase === 'embed') {
                const value = structuredClone(state.value) as JsonObject;
                if (state.tool === 'set_cell_range') { const dims = state.dimensions as JsonObject; value.cells = [[{ rich_text: [{ type: 'embed-image', text: '', image_token: state.imageToken, image_width: dims.width, image_height: dims.height }] }]]; }
                else (value.properties as JsonObject).image_token = state.imageToken;
                const output = await invokeSheetTool(context.lark, { method: 'POST', path: `/open-apis/sheet_ai/v2/spreadsheets/${encodeURIComponent(String(state.token))}/tools/invoke_write`, body: { tool_name: state.tool, input: JSON.stringify(value) } });
                return { done: true, output };
            }
            if (!artifacts || typeof (artifacts as ArtifactFiles).stat !== 'function') throw new ServiceError('ARTIFACT_UNAVAILABLE', 'Artifact file metadata is not configured.', 503);
            authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
            const args = state.args as JsonObject;
            if (['start', 'metadata'].includes(String(state.phase)) && state.tool === 'set_cell_range') {
                const size = state.size === undefined ? (await (artifacts as ArtifactFiles).stat(context.grant.id, String(args.image))).size : Number(state.size);
                const metadata = (state.metadata ?? {}) as JsonObject, offset = Number(metadata.offset ?? 0);
                const response = await artifacts.read(context.grant.id, String(args.image), { offset, length: Math.min(size - offset, 65536) });
                const result = scanImageMetadata(new Uint8Array(await response.arrayBuffer()), metadata, size);
                return result.done ? { done: false, state: { ...state, dimensions: result.dimensions, phase: 'upload' } } : { done: false, state: { ...state, metadata: result.state, size, phase: 'metadata' } };
            }
            const program = uploadPrograms(artifacts as ArtifactFiles).find(p => p.id === 'docs-media-upload')!;
            const uploadState = state.upload as JsonObject ?? { phase: 'start', args: { file: args.image, name: args.name || args['image-name'] || args.image, 'parent-type': sheetImageParent(String(state.token)), 'parent-node': state.token } };
            const result = await program.step(uploadState, context);
            if (!result.done) return { done: false, state: { ...state, upload: result.state, phase: 'upload' } };
            return { done: false, state: { ...state, imageToken: (result.output as JsonObject).file_token, phase: 'embed' } };
        },
    };
}

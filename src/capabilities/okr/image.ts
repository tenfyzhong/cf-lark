import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { LarkTransferClient } from '../../ports/lark';
import type { WorkflowProgram } from '../../ports/workflows';
import { choice, id, invalid, type Data } from './content';
export function imagePlan(args: Data) {
    const name = String(args.name ?? args.file ?? '');
    if (!String(args.file ?? '').trim() || /[\r\n\0"/\\]/.test(name) || !/\.(jpg|jpeg|png|gif|bmp)$/i.test(name)) invalid('Provide a private artifact ID and a JPG, JPEG, PNG, GIF, or BMP filename.');
    return { path: '/open-apis/okr/v1/images/upload', artifactId: String(args.file), name,
        fields: { target_id: id(args['target-id']), target_type: choice(args['target-type'], ['objective', 'key_result']) === 'objective' ? '2' : '3' } };
}
export function imageProgram(artifacts: ArtifactFiles): WorkflowProgram {
    return { id: 'okr-image', version: 1, domain: 'okr', risk: 'write', identities: ['user', 'bot'], step: async (state, context) => {
        const prepared = imagePlan(state.args as Data);
        authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
        const artifact = await artifacts.stat(context.grant.id, prepared.artifactId);
        const response = await artifacts.read(context.grant.id, prepared.artifactId);
        if (!response.body) throw new ServiceError('INVALID_ARTIFACT', 'Artifact body is missing.');
        const result = await (context.lark as LarkTransferClient).uploadStream({ path: prepared.path, fields: prepared.fields, file: { field: 'data', name: prepared.name, size: artifact.size, body: response.body } });
        if (!result.file_token) throw new ServiceError('INVALID_UPSTREAM_RESPONSE', 'Image upload response has no file_token.');
        return { done: true, output: { file_token: result.file_token, url: result.url ?? '', file_name: prepared.name, size: artifact.size } };
    } };
}

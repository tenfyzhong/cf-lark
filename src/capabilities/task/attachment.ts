import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { LarkTransferClient } from '../../ports/lark';
import type { WorkflowProgram } from '../../ports/workflows';
import { guid } from './write';
import { invalid } from './query';
const limit = 50 * 1024 * 1024;
export function attachmentPreview(args: JsonObject) {
    const artifactId = String(args.file ?? '').trim();
    if (!artifactId) invalid('file must be a grant-owned artifact ID.');
    const name = String(args.name ?? artifactId);
    if (!name || /[\r\n\0/\\]/.test(name)) invalid('Attachment name must be a safe filename.');
    return { method: 'POST', path: '/open-apis/task/v2/attachments/upload', query: { user_id_type: String(args['user-id-type'] || 'open_id') }, multipart: {
        fields: { resource_id: guid(args['resource-id']), resource_type: String(args['resource-type'] || 'task') }, artifactId, name, field: 'file', maxBytes: limit,
    } };
}
export function attachmentProgram(artifacts: ArtifactFiles): WorkflowProgram {
    return { id: 'task-attachment', version: 1, domain: 'task', risk: 'write', identities: ['user', 'bot'], step: async (state, context) => {
        const prepared = attachmentPreview(state.args as JsonObject);
        authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
        const artifact = await artifacts.stat(context.grant.id, prepared.multipart.artifactId);
        if (artifact.size > limit || artifact.size <= 0) invalid('Task attachments must contain between 1 byte and 50 MiB.');
        const response = await artifacts.read(context.grant.id, prepared.multipart.artifactId);
        if (!response.body) throw new ServiceError('INVALID_ARTIFACT', 'Artifact has no readable body.');
        const data = await (context.lark as LarkTransferClient).uploadStream({ path: prepared.path, query: prepared.query, fields: prepared.multipart.fields,
            file: { field: 'file', name: prepared.multipart.name, size: artifact.size, body: response.body } });
        const first = Array.isArray(data.items) ? data.items[0] : undefined;
        return { done: true, output: first && typeof first === 'object' && !Array.isArray(first) ? first : {} };
    } };
}

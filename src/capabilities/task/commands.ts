import type { ArtifactFiles } from '../../ports/artifacts';
import { attachmentPreview, attachmentProgram } from './attachment';
import type { Capability } from '../../ports/capabilities';
import type { WorkflowRunner, WorkflowProgram } from '../../ports/workflows';
import { taskDefinitions } from './definitions';
import { writePlan, writeProgram } from './write';
import { queryProgram, queryRequest } from './query';
export function taskCapabilities(workflows: WorkflowRunner): Capability[] {
    return taskDefinitions.map(definition => {
        const action = definition.id.split('.+')[1]!;
        const read = definition.risk === 'read';
        if (action === 'upload-attachment') return { definition, preview: async args => attachmentPreview(args), execute: async (args, context) => { attachmentPreview(args); return workflows.start('task-attachment', { args }, context.selection, context.grant); } };
        return { definition, preview: async args => ({ requests: read ? [queryRequest(action, args)] : writePlan(action, args).requests, continuation: 'Fetch pages and enrich search details, at most one upstream request per workflow step.' }),
            execute: async (args, context) => {
                if (read) queryRequest(action, args); else writePlan(action, args);
                return workflows.start(read ? 'task-query' : 'task-write', { action, args, phase: 'start' }, context.selection, context.grant);
            } };
    });
}
export function taskPrograms(artifacts?: ArtifactFiles): WorkflowProgram[] { return [queryProgram(), writeProgram(), ...(artifacts ? [attachmentProgram(artifacts)] : [])]; }

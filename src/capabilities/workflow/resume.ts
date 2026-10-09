import type { Capability } from '../../ports/capabilities';
import type { WorkflowRunner } from '../../ports/workflows';
import { workflowDefinition } from './definition';

export function workflowCapability(runner: WorkflowRunner): Capability {
    return { definition: workflowDefinition,
        preview: async (args) => ({ operation: 'resume', workflowId: args.id, advancesAtMostOneStep: true }),
        execute: (args, context) => runner.resume(String(args.id), context.grant, context.selection),
    };
}

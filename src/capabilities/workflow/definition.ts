import type { CommandDefinition } from '../../domain/models';

export const workflowDefinition: CommandDefinition = {
    id: 'workflow.resume', domain: 'workflow', source: 'service', risk: 'read', identities: ['user', 'bot'], scopes: [],
    description: 'Advance one bounded step of a pending workflow using its workflowId and exact returned selection. Repeat while status is pending. Completed results are replayed without writes. Never restart the original command after an uncertain outcome.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', minLength: 1, description: 'workflowId returned by the initiating command.' } } },
};

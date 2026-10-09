import type { ExecutionSelection, Grant, Identity, JsonObject, Risk } from '../domain/models';
import type { CommandContext } from './capabilities';

export interface WorkflowRecord {
    id: string;
    owner: string;
    program: string;
    version: number;
    selection: ExecutionSelection;
    state: JsonObject;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'uncertain';
    revision: number;
    expiresAt: number;
    nextRunAt?: number;
    output?: unknown;
    error?: { code: string; message: string };
}
export interface WorkflowStore {
    create(record: WorkflowRecord): Promise<void>;
    get(owner: string, id: string): Promise<WorkflowRecord | undefined>;
    transition(record: WorkflowRecord, expectedRevision: number): Promise<boolean>;
}
export interface WorkflowProgram {
    id: string;
    version: number;
    domain: string;
    risk: Risk;
    identities: readonly Identity[];
    step(state: JsonObject, context: CommandContext): Promise<
        { done: true; output: unknown } | { done: false; state: JsonObject; nextRunAt?: number; retryAfter?: number }
    >;
}
export interface WorkflowResult {
    workflowId: string;
    selection: ExecutionSelection;
    status: 'pending' | 'completed';
    nextRunAt?: number;
    retryAfter?: number;
    output?: unknown;
}
export interface WorkflowRunner {
    start(program: string, state: JsonObject, selection: ExecutionSelection, grant: Grant): Promise<WorkflowResult>;
    resume(id: string, grant: Grant, selection?: ExecutionSelection): Promise<WorkflowResult>;
}

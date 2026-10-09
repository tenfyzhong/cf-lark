import { authorize } from '../domain/authorization';
import { ServiceError } from '../domain/errors';
import type { ExecutionSelection, Grant, JsonObject } from '../domain/models';
import type { LarkClient } from '../ports/lark';
import type { WorkflowProgram, WorkflowRecord, WorkflowResult, WorkflowRunner, WorkflowStore } from '../ports/workflows';

export class WorkflowService implements WorkflowRunner {
    private readonly programs: ReadonlyMap<string, WorkflowProgram>;

    constructor(private readonly store: WorkflowStore, programs: readonly WorkflowProgram[],
        private readonly createClient: (selection: ExecutionSelection) => Promise<LarkClient>,
        private readonly now: () => number = Date.now) {
        this.programs = new Map(programs.map((program) => [program.id, program]));
        if (this.programs.size !== programs.length) throw new ServiceError('DUPLICATE_PROGRAM', 'Duplicate workflow program.', 500);
    }

    private program(id: string, selection: ExecutionSelection, grant: Grant): WorkflowProgram {
        const program = this.programs.get(id);
        if (!program) throw new ServiceError('UNKNOWN_WORKFLOW', 'The workflow program is not registered.', 404);
        authorize(grant, { ...selection, domain: program.domain, risk: program.risk }, this.now());
        if (!program.identities.includes(selection.identity)) throw new ServiceError('FORBIDDEN', 'This identity cannot execute the workflow.', 403);
        return program;
    }

    private pending(record: WorkflowRecord): WorkflowResult {
        const remaining = record.nextRunAt === undefined ? 0 : Math.max(0, record.nextRunAt - this.now());
        return { workflowId: record.id, selection: record.selection, status: 'pending', ...(remaining > 0 ? { nextRunAt: record.nextRunAt, retryAfter: remaining } : {}) };
    }

    private schedule(step: { nextRunAt?: number; retryAfter?: number }, expiresAt: number): number | undefined {
        if (step.nextRunAt !== undefined && step.retryAfter !== undefined) throw new ServiceError('INVALID_WORKFLOW_SCHEDULE', 'Provide nextRunAt or retryAfter, not both.', 500);
        for (const value of [step.nextRunAt, step.retryAfter]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new ServiceError('INVALID_WORKFLOW_SCHEDULE', 'Workflow scheduling requires nonnegative integer milliseconds.', 500);
        const target = step.nextRunAt ?? (step.retryAfter === undefined ? undefined : this.now() + step.retryAfter);
        return target === undefined ? undefined : Math.min(target, expiresAt);
    }

    async start(id: string, state: JsonObject, selection: ExecutionSelection, grant: Grant): Promise<WorkflowResult> {
        const program = this.program(id, selection, grant);
        const record: WorkflowRecord = { id: crypto.randomUUID(), owner: grant.id, program: id, version: program.version,
            selection, state, status: 'pending', revision: 0, expiresAt: Math.min(grant.expiresAt, this.now() + 86400_000) };
        await this.store.create(record);
        return this.resume(record.id, grant);
    }

    async resume(id: string, grant: Grant, selection?: ExecutionSelection): Promise<WorkflowResult> {
        const record = await this.store.get(grant.id, id);
        if (!record || record.expiresAt <= this.now()) throw new ServiceError('WORKFLOW_NOT_FOUND', 'The workflow is unavailable.', 404);
        const program = this.program(record.program, record.selection, grant);
        if (selection && (selection.profileId !== record.selection.profileId || selection.accountId !== record.selection.accountId || selection.identity !== record.selection.identity)) {
            throw new ServiceError('SELECTION_REQUIRED', 'Resume using the workflow execution selection.', 400, { selection: record.selection });
        }
        if (program.version !== record.version) throw new ServiceError('WORKFLOW_VERSION_CHANGED', 'The stored workflow requires its original program version.', 409);
        if (record.status === 'completed') return { workflowId: id, selection: record.selection, status: 'completed', output: record.output };
        if (record.status === 'running' || record.status === 'uncertain') throw new ServiceError('OUTCOME_UNCERTAIN', 'The previous step may still be running or its outcome is unknown. Do not repeat the initial write.', 409, { workflowId: id });
        if (record.status === 'failed') throw new ServiceError(record.error?.code ?? 'WORKFLOW_FAILED', record.error?.message ?? 'The workflow failed.', 409, { workflowId: id });
        if (record.nextRunAt !== undefined && this.now() < record.nextRunAt) return this.pending(record);
        const running: WorkflowRecord = { ...record, status: 'running', revision: record.revision + 1 };
        if (!await this.store.transition(running, record.revision)) throw new ServiceError('WORKFLOW_BUSY', 'Another invocation acquired this workflow step.', 409);
        try {
            const step = await program.step(structuredClone(record.state), { grant, selection: record.selection, lark: await this.createClient(record.selection) });
            const next: WorkflowRecord = step.done
                ? { ...running, nextRunAt: undefined, status: 'completed', output: step.output, revision: running.revision + 1 }
                : { ...running, nextRunAt: this.schedule(step, record.expiresAt), status: 'pending', state: step.state, revision: running.revision + 1 };
            if (!await this.store.transition(next, running.revision)) throw new Error('Workflow checkpoint was not committed.');
            return step.done ? { workflowId: id, selection: record.selection, status: 'completed', output: step.output } : this.pending(next);
        } catch (error) {
            const uncertain = !(error instanceof ServiceError) || error.code === 'OUTCOME_UNCERTAIN';
            const failure = uncertain ? new ServiceError('OUTCOME_UNCERTAIN', 'The workflow step outcome could not be confirmed. Do not repeat the initial write.', 502, { workflowId: id }) : error;
            await this.store.transition({ ...running, status: uncertain ? 'uncertain' : 'failed', revision: running.revision + 1,
                error: { code: failure.code, message: failure.message } }, running.revision);
            throw failure;
        }
    }
}

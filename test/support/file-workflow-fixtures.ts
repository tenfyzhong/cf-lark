import { ServiceError } from '../../src/domain/errors';
import type { Artifact, ArtifactFiles } from '../../src/ports/artifacts';
import type { WorkflowRecord, WorkflowStore } from '../../src/ports/workflows';

const artifacts = new Map<string, { metadata: Artifact; body: Blob }>();
const workflows = new Map<string, WorkflowRecord>();
function owned(owner: string, id: string) {
    const value = artifacts.get(id);
    if (!value || value.metadata.owner !== owner) throw new ServiceError('ARTIFACT_NOT_FOUND', 'Fixture artifact not found.', 404);
    return value;
}
export const fixtureFiles: ArtifactFiles = {
    upload: async (owner, size, body) => {
        const blob = await new Response(body).blob();
        if (blob.size !== size) throw new Error('Fixture length mismatch.');
        const metadata: Artifact = { owner, size, id: crypto.randomUUID(), expiresAt: Date.now() + 60_000, state: 'ready' };
        artifacts.set(metadata.id, { metadata, body: blob });
        return metadata;
    },
    stat: async (owner, id) => owned(owner, id).metadata,
    read: async (owner, id, range) => {
        const file = owned(owner, id);
        const body = range ? file.body.slice(range.offset, range.offset + range.length) : file.body;
        return new Response(body, { headers: { 'Content-Length': String(body.size) } });
    },
    remove: async (owner, id) => { owned(owner, id); artifacts.delete(id); },
};
export const fixtureWorkflows: WorkflowStore = {
    create: async (record) => { workflows.set(record.id, structuredClone(record)); },
    get: async (owner, id) => { const value = workflows.get(id); return value?.owner === owner ? structuredClone(value) : undefined; },
    transition: async (record, revision) => {
        const current = workflows.get(record.id);
        if (!current || current.owner !== record.owner || current.revision !== revision) return false;
        workflows.set(record.id, structuredClone(record)); return true;
    },
};

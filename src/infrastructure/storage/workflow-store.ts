import { ServiceError } from '../../domain/errors';
import type { Encryption } from '../../ports/credentials';
import type { WorkflowRecord, WorkflowStore } from '../../ports/workflows';
import type { SqlDatabase } from './sql';
import { EncryptedWorkflowBlobs, type WorkflowBlobReference } from './workflow-blobs';
import { jsonSize, MAX_WORKFLOW_BYTES } from './workflow-json';
interface StoredEnvelope { workflowStorage: 1; record: WorkflowRecord; stateBlob?: WorkflowBlobReference; outputBlob?: WorkflowBlobReference }
interface Encoding { payload: string; refs: WorkflowBlobReference[]; fresh: WorkflowBlobReference[] }
const INLINE_BYTES = 512 * 1024;
export class SqliteWorkflowStore implements WorkflowStore {
    constructor(private readonly sql: SqlDatabase, private readonly encryption: Encryption, private readonly blobs?: EncryptedWorkflowBlobs) {
        sql.exec('CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, owner TEXT NOT NULL, revision INTEGER NOT NULL, expires_at INTEGER NOT NULL, payload TEXT NOT NULL)');
        if (![...sql.exec('PRAGMA table_info(workflows)')].some((row) => row.name === 'blob_ids')) sql.exec("ALTER TABLE workflows ADD COLUMN blob_ids TEXT NOT NULL DEFAULT '[]'");
        sql.exec('CREATE INDEX IF NOT EXISTS workflows_expiry ON workflows(expires_at)');
        sql.exec('CREATE TABLE IF NOT EXISTS workflow_blob_refs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, workflow_id TEXT NOT NULL, active INTEGER NOT NULL, payload TEXT NOT NULL)');
        sql.exec('CREATE TABLE IF NOT EXISTS workflow_read_leases (id TEXT PRIMARY KEY, owner TEXT NOT NULL, workflow_id TEXT NOT NULL, expires_at INTEGER NOT NULL)');
        sql.exec('CREATE INDEX IF NOT EXISTS workflow_blob_owner ON workflow_blob_refs(owner, workflow_id, active)');
    }
    private async encode(source: WorkflowRecord): Promise<Encoding> {
        const record = source.status === 'completed' ? { ...source, state: {} } : source;
        const size = jsonSize(record, this.blobs ? MAX_WORKFLOW_BYTES : INLINE_BYTES);
        if (size <= INLINE_BYTES) return { payload: await this.encryption.encrypt(`workflow:${record.owner}:${record.id}`, JSON.stringify(record)), refs: [], fresh: [] };
        if (!this.blobs) throw new ServiceError('WORKFLOW_TOO_LARGE', 'Workflow state must not exceed 512 KiB.', 413);
        const envelope: StoredEnvelope = { workflowStorage: 1, record: { ...record } }, refs: WorkflowBlobReference[] = [], fresh: WorkflowBlobReference[] = [];
        try {
            for (const key of ['state', 'output'] as const) {
                const value = record[key]; if (value === undefined || jsonSize(value) < 128 * 1024) continue;
                const reference = await this.blobs.write(record.owner, record.id, value); fresh.push(reference);
                refs.push(reference);
                if (key === 'state') { envelope.stateBlob = reference; envelope.record.state = {}; } else { envelope.outputBlob = reference; delete envelope.record.output; }
            }
            jsonSize(envelope, INLINE_BYTES);
            return { payload: await this.encryption.encrypt(`workflow:${record.owner}:${record.id}`, JSON.stringify(envelope)), refs, fresh };
        } catch (error) { await this.removeFresh(fresh); throw error; }
    }
    private async removeFresh(references: WorkflowBlobReference[]) {
        for (const reference of references) { try { await this.blobs?.remove(reference); this.sql.exec('DELETE FROM workflow_blob_refs WHERE id = ?', reference.id); } catch { /* The shared artifact ledger retains failed cleanup for expiry. */ } }
    }
    private async referencePayloads(owner: string, id: string, references: WorkflowBlobReference[]) {
        return Promise.all(references.map(async (reference) => ({ reference, payload: await this.encryption.encrypt(`workflow-ref:${owner}:${id}:${reference.id}`, JSON.stringify(reference)) })));
    }
    private installReferences(owner: string, id: string, references: { reference: WorkflowBlobReference; payload: string }[]) {
        for (const { reference, payload } of references) this.sql.exec('INSERT INTO workflow_blob_refs(id, owner, workflow_id, active, payload) VALUES (?, ?, ?, 1, ?) ON CONFLICT(id) DO NOTHING', reference.id, owner, id, payload);
    }
    async create(record: WorkflowRecord) {
        const encoded = await this.encode(record);
        try {
            const refs = await this.referencePayloads(record.owner, record.id, encoded.refs);
            this.installReferences(record.owner, record.id, refs);
            this.sql.exec('INSERT INTO workflows(id, owner, revision, expires_at, payload, blob_ids) VALUES (?, ?, ?, ?, ?, ?)', record.id, record.owner, record.revision, record.expiresAt, encoded.payload, JSON.stringify(encoded.refs.map((reference) => reference.id)));
        } catch (error) { await this.removeFresh(encoded.fresh); throw error; }
    }
    async get(owner: string, id: string): Promise<WorkflowRecord | undefined> {
        const row = [...this.sql.exec('SELECT payload FROM workflows WHERE id = ? AND owner = ?', id, owner)][0];
        if (!row) return;
        const lease = crypto.randomUUID();
        this.sql.exec('INSERT INTO workflow_read_leases(id, owner, workflow_id, expires_at) VALUES (?, ?, ?, ?)', lease, owner, id, Date.now() + 120000);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const read = async () => {
                const decoded = JSON.parse(await this.encryption.decrypt(`workflow:${owner}:${id}`, String(row.payload))) as WorkflowRecord | StoredEnvelope;
                if (!('workflowStorage' in decoded) || decoded.workflowStorage !== 1) return decoded as WorkflowRecord;
                if (!this.blobs) throw new ServiceError('WORKFLOW_STORAGE_UNAVAILABLE', 'Internal workflow blob storage is unavailable.', 503);
                const result = decoded.record;
                for (const [key, reference] of [['state', decoded.stateBlob], ['output', decoded.outputBlob]] as const) if (reference) {
                    const value = await this.blobs.read(owner, id, reference);
                    if (key === 'state') result.state = value as WorkflowRecord['state']; else result.output = value;
                }
                return result;
            };
            return await Promise.race([read(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ServiceError('WORKFLOW_READ_TIMEOUT', 'Workflow storage read timed out.', 504)), 60000); })]);
        } finally {
            clearTimeout(timer); this.sql.exec('DELETE FROM workflow_read_leases WHERE id = ?', lease);
            await this.cleanupBlobs(Date.now());
        }
    }
    async transition(record: WorkflowRecord, expectedRevision: number): Promise<boolean> {
        if (record.revision !== expectedRevision + 1) throw new ServiceError('INVALID_REVISION', 'Workflow revisions must advance exactly once.', 500);
        const encoded = await this.encode(record);
        let committed = false;
        try {
            const refs = await this.referencePayloads(record.owner, record.id, encoded.refs);
            this.installReferences(record.owner, record.id, refs);
            const rows = this.sql.exec('UPDATE workflows SET revision = ?, expires_at = ?, payload = ?, blob_ids = ? WHERE id = ? AND owner = ? AND revision = ? RETURNING id', record.revision, record.expiresAt, encoded.payload, JSON.stringify(encoded.refs.map((reference) => reference.id)), record.id, record.owner, expectedRevision);
            committed = [...rows].length === 1;
        } finally { if (!committed) await this.removeFresh(encoded.fresh); }
        if (committed) await this.cleanupBlobs(Date.now());
        return committed;
    }
    private async cleanupBlobs(now: number) {
        this.sql.exec('DELETE FROM workflow_read_leases WHERE expires_at <= ?', now);
        if (!this.blobs) return;
        const rows = [...this.sql.exec(`SELECT id, owner, workflow_id, payload FROM workflow_blob_refs AS refs WHERE NOT EXISTS (SELECT 1 FROM workflows, json_each(workflows.blob_ids) AS blob WHERE blob.value = refs.id)
            AND NOT EXISTS (SELECT 1 FROM workflow_read_leases AS leases WHERE leases.owner = refs.owner AND leases.workflow_id = refs.workflow_id)
            LIMIT 100`)];
        for (const row of rows) {
            try {
                const reference = JSON.parse(await this.encryption.decrypt(`workflow-ref:${row.owner}:${row.workflow_id}:${row.id}`, String(row.payload))) as WorkflowBlobReference;
                await this.blobs.remove(reference);
                this.sql.exec('DELETE FROM workflow_blob_refs WHERE id = ?', String(row.id));
            } catch { /* Keep the reference and storage reservation for retry during scheduled cleanup. */ }
        }
    }
    async cleanup(now: number): Promise<number> {
        const rows = [...this.sql.exec('DELETE FROM workflows WHERE id IN (SELECT id FROM workflows WHERE expires_at <= ? LIMIT 100) RETURNING id, owner', now)];
        await this.cleanupBlobs(now);
        return rows.length;
    }
}

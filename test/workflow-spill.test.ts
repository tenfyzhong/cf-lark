import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { SqliteWorkflowStore } from '../src/infrastructure/storage/workflow-store';
import { EncryptedWorkflowBlobs } from '../src/infrastructure/storage/workflow-blobs';
import { SecretBox } from '../src/infrastructure/crypto/secret-box';
import type { WorkflowRecord } from '../src/ports/workflows';
function fixture() {
    const db = new DatabaseSync(':memory:'), sql = { exec(query: string, ...args: (string | number | null)[]) { return db.prepare(query).all(...args) as Record<string, unknown>[]; } };
    const box = new SecretBox(btoa(String.fromCharCode(...new Uint8Array(32))));
    const bodies = new Map<string, { owner: string; body: Blob }>();
    const artifacts = { ingest: vi.fn().mockImplementation(async (owner, _max, stream) => { const body = await new Response(stream).blob(), id = crypto.randomUUID(); bodies.set(id, { owner, body }); return { id, size: body.size, owner, expiresAt: Date.now() + 86400000, state: 'ready' }; }), read: vi.fn().mockImplementation(async (owner, id) => { const entry = bodies.get(id); if (!entry || entry.owner !== owner) throw new Error('Not owned'); return new Response(entry.body); }), remove: vi.fn().mockImplementation(async (owner, id) => { const entry = bodies.get(id); if (entry && entry.owner !== owner) throw new Error('Not owned'); bodies.delete(id); }) };
    const blobs = new EncryptedWorkflowBlobs(artifacts as any, box), store = new SqliteWorkflowStore(sql, box, blobs);
    const record: WorkflowRecord = { id: 'workflow', owner: 'grant', program: 'read', version: 1, selection: { profileId: 'p', identity: 'user' }, state: { content: 'private\n'.repeat(100000) }, status: 'pending', revision: 0, expiresAt: Date.now() + 60000 };
    return { sql, box, bodies, artifacts, blobs, store, record };
}
it('round-trips large encrypted state without exposing grant-readable artifacts', async () => {
    const f = fixture(); await f.store.create(f.record);
    expect(f.bodies.size).toBe(1);
    expect(JSON.stringify(f.sql.exec('SELECT * FROM workflows'))).not.toContain('private');
    const entry = [...f.bodies.values()][0]!; expect(entry.owner).not.toBe('grant'); expect(await entry.body.text()).not.toContain('private');
    expect(await f.store.get('other', f.record.id)).toBeUndefined(); expect(await f.store.get('grant', f.record.id)).toEqual(f.record);
});
it('retains the winning CAS blob and removes losing staged blobs', async () => {
    const f = fixture(); await f.store.create(f.record);
    const next = { ...f.record, state: { content: 'new'.repeat(300000) }, revision: 1 };
    expect(await Promise.all([f.store.transition(next, 0), f.store.transition({ ...next, state: { content: 'loser'.repeat(200000) } }, 0)])).toEqual([true, false]);
    expect((await f.store.get('grant', f.record.id))?.state).toEqual(next.state); expect(f.bodies.size).toBe(1);
});
it('prunes intermediate state on completion and removes expired output blobs', async () => {
    const f = fixture(); await f.store.create(f.record);
    await f.store.transition({ ...f.record, revision: 1, status: 'completed', output: { rows: 'result'.repeat(150000) } }, 0);
    expect((await f.store.get('grant', f.record.id))?.state).toEqual({}); expect(f.bodies.size).toBe(1);
    expect(await f.store.cleanup(f.record.expiresAt)).toBe(1); expect(f.bodies.size).toBe(0);
});
it('rejects truncated encrypted streams and owner substitution', async () => {
    const f = fixture(); await f.store.create(f.record);
    const [id, entry] = [...f.bodies][0]!; const raw = await entry.body.text(); entry.body = new Blob([raw.slice(0, raw.lastIndexOf('\n', raw.length - 2) + 1)]);
    await expect(f.store.get('grant', f.record.id)).rejects.toMatchObject({ code: 'INVALID_WORKFLOW_BLOB' });
    expect(f.bodies.has(id)).toBe(true);
});
it('enforces the serialized record bound before uploading', async () => {
    const f = fixture(); await expect(f.store.create({ ...f.record, state: { content: 'x'.repeat(33 * 1024 * 1024) } })).rejects.toMatchObject({ code: 'WORKFLOW_TOO_LARGE' });
    expect(f.artifacts.ingest).not.toHaveBeenCalled();
});
it('protects an in-flight old reader while a new revision retires its blob', async () => {
    const f = fixture(); await f.store.create(f.record);
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }), start = new Promise<void>((resolve) => { started = resolve; });
    f.artifacts.read.mockImplementationOnce(async (owner, id) => { started(); await gate; const entry = f.bodies.get(id)!; expect(entry.owner).toBe(owner); return new Response(entry.body); });
    const reading = f.store.get('grant', f.record.id); await start;
    await f.store.transition({ ...f.record, revision: 1, state: { content: 'replacement'.repeat(100000) } }, 0);
    expect(f.bodies.size).toBe(2); release(); expect(await reading).toEqual(f.record); expect(f.bodies.size).toBe(1);
});
it('does not reuse authenticated references across workflow IDs', async () => {
    const f = fixture(); await f.store.create(f.record); const loaded = await f.store.get('grant', f.record.id);
    const copy = { ...loaded!, id: 'another' }; await f.store.create(copy);
    expect(await f.store.get('grant', 'another')).toEqual(copy); expect(f.bodies.size).toBe(2);
});
it('streams JSON escapes, surrogate pairs, arrays, and prototype-looking keys safely', async () => {
    const f = fixture(), value = { unicode: '\uD83D\uDE00\u0000\n\\"\t'.repeat(100000), items: [null, true, false, -2.5e20, { nested: [] }] };
    Object.defineProperty(value, '__proto__', { value: { safe: true }, enumerable: true });
    await f.store.create({ ...f.record, state: value });
    const loaded = await f.store.get('grant', f.record.id); expect(loaded?.state).toEqual(value); expect(Object.getPrototypeOf(loaded?.state)).toBe(Object.prototype);
});
it('retains exactly one live blob after a running claim replaces its checkpoint', async () => {
    const f = fixture(); await f.store.create(f.record); const loaded = (await f.store.get('grant', f.record.id))!;
    await f.store.transition({ ...loaded, status: 'running', revision: 1 }, 0);
    expect(f.artifacts.ingest).toHaveBeenCalledTimes(2); expect(f.bodies.size).toBe(1); expect(await f.store.get('grant', f.record.id)).toMatchObject({ status: 'running', revision: 1 });
});
it('bounds structural JSON amplification before allocating blob storage', async () => {
    const f = fixture(); await expect(f.store.create({ ...f.record, state: { items: Array.from({ length: 100001 }, () => ({})) } })).rejects.toMatchObject({ code: 'WORKFLOW_TOO_COMPLEX' });
    expect(f.artifacts.ingest).not.toHaveBeenCalled();
});
it('does not reuse a pending checkpoint after callers change its decoded state', async () => {
    const f = fixture(); await f.store.create(f.record); const loaded = (await f.store.get('grant', f.record.id))!;
    loaded.state.content = 'changed'.repeat(120000);
    await f.store.transition({ ...loaded, revision: 1 }, 0);
    expect((await f.store.get('grant', f.record.id))?.state.content).toBe(loaded.state.content);
});
it('cleans stale references after the shared artifact expiration job already removed a blob', async () => {
    const { ServiceError } = await import('../src/domain/errors');
    const f = fixture(); await f.store.create(f.record); f.bodies.clear();
    f.artifacts.remove.mockRejectedValue(new ServiceError('ARTIFACT_NOT_FOUND', 'Expired.', 404));
    await f.store.cleanup(f.record.expiresAt);
    expect(f.sql.exec('SELECT * FROM workflow_blob_refs')).toEqual([]);
});

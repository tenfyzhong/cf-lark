import { env, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { ArtifactService } from '../../src/application/artifacts';
import { SecretBox } from '../../src/infrastructure/crypto/secret-box';
import { SqliteArtifactLedger } from '../../src/infrastructure/storage/artifact-ledger';
import { PrivateR2Bucket } from '../../src/infrastructure/storage/r2-bucket';
import { EncryptedWorkflowBlobs } from '../../src/infrastructure/storage/workflow-blobs';
import { SqliteWorkflowStore } from '../../src/infrastructure/storage/workflow-store';
import type { Env } from '../../src/bootstrap/worker';
it('round-trips a near-limit 31 MiB checkpoint in native Durable Object SQLite and R2', async () => {
    const bindings = env as unknown as Env, stub = bindings.AUTHORITY.getByName('workflow-spill-memory');
    await runInDurableObject(stub, async (_instance, state) => {
        const ledger = new SqliteArtifactLedger(state.storage.sql, { maxBytes: 2_000_000_000, maxClassA: 10000, maxClassB: 10000 });
        const artifacts = new ArtifactService(ledger, new PrivateR2Bucket(bindings.ARTIFACTS));
        const encryption = new SecretBox('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
        const store = new SqliteWorkflowStore(state.storage.sql, encryption, new EncryptedWorkflowBlobs(artifacts, encryption));
        const size = 31 * 1024 * 1024, content = 'x'.repeat(size), expiresAt = Date.now() + 60000;
        await store.create({ id: 'large', owner: 'read-only-grant', program: 'read', version: 1, selection: { profileId: 'p', identity: 'user' }, state: { content }, status: 'pending', revision: 0, expiresAt });
        const usage = await artifacts.usage(); expect(usage.bytes).toBeGreaterThan(size); expect(usage.bytes).toBeLessThan(2_000_000_000);
        const loaded = await store.get('read-only-grant', 'large'); expect((loaded?.state.content as string).length).toBe(size); expect((loaded?.state.content as string).slice(-16)).toBe('x'.repeat(16));
        const row = [...state.storage.sql.exec('SELECT payload FROM workflows')][0]!; expect(String(row.payload).length).toBeLessThan(512 * 1024);
        await store.cleanup(expiresAt); expect((await artifacts.usage()).bytes).toBe(0);
    });
}, 120000);

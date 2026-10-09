import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { SqliteWorkflowStore } from '../src/infrastructure/storage/workflow-store';
import { SecretBox } from '../src/infrastructure/crypto/secret-box';
import type { WorkflowRecord } from '../src/ports/workflows';

it('encrypts workflow data, checks ownership and atomically claims revisions', async () => {
    const db = new DatabaseSync(':memory:');
    const sql = { exec(query: string, ...args: (string | number | null)[]) { return db.prepare(query).all(...args) as Record<string, unknown>[]; } };
    const box = new SecretBox(btoa(String.fromCharCode(...new Uint8Array(32))));
    const store = new SqliteWorkflowStore(sql, box);
    const record: WorkflowRecord = { id: 'workflow', owner: 'grant', program: 'upload', version: 1, selection: { profileId: 'p', identity: 'bot' },
        state: { private_value: 'confidential-content' }, status: 'pending', revision: 0, expiresAt: 1000 };
    await store.create(record);
    expect(JSON.stringify(sql.exec('SELECT * FROM workflows'))).not.toContain('confidential-content');
    expect(await store.get('other', record.id)).toBeUndefined();
    expect(await store.get('grant', record.id)).toEqual(record);
    const running = { ...record, status: 'running' as const, revision: 1 };
    expect(await Promise.all([store.transition(running, 0), store.transition(running, 0)])).toEqual([true, false]);
    expect(await store.transition({ ...running, owner: 'other', revision: 2 }, 1)).toBe(false);
    expect(await store.get('grant', record.id)).toEqual(running);
    expect(await store.cleanup(999)).toBe(0);
    expect(await store.cleanup(1000)).toBe(1);
    expect(await store.get('grant', record.id)).toBeUndefined();
});

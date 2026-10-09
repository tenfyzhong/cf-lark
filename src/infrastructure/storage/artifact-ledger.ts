import type { Artifact, ArtifactLedger } from '../../ports/artifacts';
import type { SqlDatabase } from './sql';
import { ServiceError } from '../../domain/errors';

export class SqliteArtifactLedger implements ArtifactLedger {
    constructor(private readonly sql: SqlDatabase,
        private readonly limits: { maxBytes: number; maxClassA: number; maxClassB: number },
        private readonly now: () => number = Date.now) {
        for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new ServiceError('INVALID_CONFIGURATION', 'Artifact limits must be positive safe integers.', 500);
        sql.exec('CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, owner TEXT NOT NULL, size INTEGER NOT NULL, expires INTEGER NOT NULL, state TEXT NOT NULL)');
        sql.exec('CREATE INDEX IF NOT EXISTS artifacts_expiry ON artifacts(expires)');
        sql.exec('CREATE TABLE IF NOT EXISTS artifact_multipart (id TEXT PRIMARY KEY, upload_id TEXT NOT NULL)');
        sql.exec('CREATE TABLE IF NOT EXISTS artifact_budget (month TEXT PRIMARY KEY, class_a INTEGER NOT NULL DEFAULT 0, class_b INTEGER NOT NULL DEFAULT 0)');
    }

    async reserve(artifact: Artifact) {
        const result = Array.from(this.sql.exec(`INSERT INTO artifacts (id, owner, size, expires, state)
            SELECT ?, ?, ?, ?, 'reserved' WHERE (SELECT COALESCE(SUM(size), 0) FROM artifacts) + ? <= ? RETURNING id`,
        artifact.id, artifact.owner, artifact.size, artifact.expiresAt, artifact.size, this.limits.maxBytes));
        if (!result.length) throw new ServiceError('STORAGE_LIMIT', 'Temporary storage capacity is exhausted.', 429);
    }

    async reserveUpTo(artifact: Artifact) {
        const rows = Array.from(this.sql.exec(`INSERT INTO artifacts (id, owner, size, expires, state)
            SELECT ?, ?, MIN(?, capacity), ?, 'reserved' FROM
            (SELECT ? - COALESCE(SUM(size), 0) AS capacity FROM artifacts)
            WHERE capacity > 0 RETURNING size`, artifact.id, artifact.owner, artifact.size, artifact.expiresAt, this.limits.maxBytes));
        if (!rows.length) throw new ServiceError('STORAGE_LIMIT', 'Temporary storage capacity is exhausted.', 429);
        return Number(rows[0]!.size);
    }

    private decode(row: Record<string, unknown>): Artifact {
        return { id: String(row.id), owner: String(row.owner), size: Number(row.size), expiresAt: Number(row.expires), state: row.state as Artifact['state'] };
    }
    async get(id: string) {
        const row = Array.from(this.sql.exec('SELECT * FROM artifacts WHERE id = ?', id))[0];
        return row ? this.decode(row) : undefined;
    }
    async resize(id: string, size: number) {
        if (!Number.isSafeInteger(size) || size < 0) throw new ServiceError('INVALID_SIZE', 'Artifact size must be nonnegative.');
        const rows = Array.from(this.sql.exec("UPDATE artifacts SET size = ? WHERE id = ? AND state = 'reserved' AND size >= ? RETURNING id", size, id, size));
        if (!rows.length) throw new ServiceError('INVALID_SIZE', 'A reservation may only shrink before completion.');
    }
    async setMultipart(id: string, uploadId: string) { this.sql.exec('INSERT INTO artifact_multipart(id, upload_id) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET upload_id = excluded.upload_id', id, uploadId); }
    async getMultipart(id: string) { const row = Array.from(this.sql.exec('SELECT upload_id FROM artifact_multipart WHERE id = ?', id))[0]; return row ? String(row.upload_id) : undefined; }
    async ready(id: string) {
        this.sql.exec('DELETE FROM artifact_multipart WHERE id = ?', id);
        this.sql.exec("UPDATE artifacts SET state = 'ready' WHERE id = ?", id);
    }
    async release(id: string) { this.sql.exec('DELETE FROM artifact_multipart WHERE id = ?', id); this.sql.exec('DELETE FROM artifacts WHERE id = ?', id); }
    private month() { return new Date(this.now()).toISOString().slice(0, 7); }
    async consume(kind: 'A' | 'B') {
        const column = kind === 'A' ? 'class_a' : 'class_b';
        const limit = kind === 'A' ? this.limits.maxClassA : this.limits.maxClassB;
        const result = Array.from(this.sql.exec(`INSERT INTO artifact_budget (month, ${column}) VALUES (?, 1)
            ON CONFLICT(month) DO UPDATE SET ${column} = ${column} + 1 WHERE ${column} < ? RETURNING month`, this.month(), limit));
        if (!result.length) throw new ServiceError('OPERATION_LIMIT', 'The monthly storage operation budget is exhausted.', 429);
    }
    async expired(limit: number) {
        return Array.from(this.sql.exec('SELECT * FROM artifacts WHERE expires <= ? ORDER BY expires LIMIT ?', this.now(), limit), (row) => this.decode(row));
    }
    async usage() {
        const bytes = Number(Array.from(this.sql.exec('SELECT COALESCE(SUM(size), 0) AS bytes FROM artifacts'))[0]!.bytes);
        const budget = Array.from(this.sql.exec('SELECT * FROM artifact_budget WHERE month = ?', this.month()))[0];
        return { bytes, classA: Number(budget?.class_a ?? 0), classB: Number(budget?.class_b ?? 0) };
    }
}

import type { ArtifactUploadRecord, ArtifactUploadStore } from '../../ports/artifacts';
import type { SqlDatabase } from './sql';
export class SqliteArtifactUploads implements ArtifactUploadStore {
    constructor(private readonly sql: SqlDatabase) {
        sql.exec('CREATE TABLE IF NOT EXISTS artifact_upload_sessions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, expires INTEGER NOT NULL, record TEXT NOT NULL)');
        sql.exec('CREATE INDEX IF NOT EXISTS artifact_upload_expiry ON artifact_upload_sessions(expires)');
    }
    async create(record: ArtifactUploadRecord) {
        this.sql.exec('INSERT INTO artifact_upload_sessions(id, revision, expires, record) VALUES (?,?,?,?)', record.id, record.revision, record.expiresAt, JSON.stringify(record));
    }
    async get(id: string) {
        const row = Array.from(this.sql.exec('SELECT record FROM artifact_upload_sessions WHERE id = ?', id))[0];
        return row ? JSON.parse(String(row.record)) as ArtifactUploadRecord : undefined;
    }
    async transition(record: ArtifactUploadRecord, expectedRevision: number) {
        return Array.from(this.sql.exec('UPDATE artifact_upload_sessions SET revision = ?, record = ? WHERE id = ? AND revision = ? RETURNING id', record.revision, JSON.stringify(record), record.id, expectedRevision)).length === 1;
    }
    async prune(now: number) {
        this.sql.exec('DELETE FROM artifact_upload_sessions WHERE expires <= ? AND NOT EXISTS (SELECT 1 FROM artifacts WHERE artifacts.id = artifact_upload_sessions.id)', now);
    }
}

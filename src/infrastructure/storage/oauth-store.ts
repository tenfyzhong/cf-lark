import type { SqlDatabase } from './sql';

/** Implements the KV subset consumed by the pinned OAuth provider, using SQLite. */
export class SqliteOAuthStore {
    private grantRevocationHook?: (owner: string) => Promise<unknown>;
    constructor(private readonly sql: SqlDatabase, private readonly now: () => number = Date.now) {
        sql.exec('CREATE TABLE IF NOT EXISTS oauth_records (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER, metadata TEXT)');
        sql.exec('CREATE INDEX IF NOT EXISTS oauth_expiration ON oauth_records(expires)');
        sql.exec('CREATE TABLE IF NOT EXISTS oauth_grant_revocations (owner TEXT PRIMARY KEY)');
        sql.exec(`CREATE TRIGGER IF NOT EXISTS oauth_grant_revocation_outbox AFTER DELETE ON oauth_records
            WHEN CASE WHEN json_valid(OLD.value) THEN
                OLD.key = 'grant:' || json_extract(OLD.value, '$.userId') || ':' || json_extract(OLD.value, '$.id')
                AND json_type(OLD.value, '$.metadata.grantId') = 'text'
                AND length(json_extract(OLD.value, '$.metadata.grantId')) BETWEEN 1 AND 128
                ELSE 0 END
            BEGIN
                INSERT OR IGNORE INTO oauth_grant_revocations(owner) VALUES(json_extract(OLD.value, '$.metadata.grantId'));
            END`);
    }

    async get<T = string>(key: string, options?: { type?: string } | string): Promise<T | null> {
        const row = [...this.sql.exec('SELECT value FROM oauth_records WHERE key = ? AND (expires IS NULL OR expires > ?)', key, Math.floor(this.now() / 1000))][0];
        if (!row) return null;
        const type = typeof options === 'string' ? options : options?.type;
        return (type === 'json' ? JSON.parse(String(row.value)) : String(row.value)) as T;
    }

    async put(key: string, value: string, options?: { expiration?: number; expirationTtl?: number; metadata?: unknown }): Promise<void> {
        const expires = options?.expiration ?? (options?.expirationTtl === undefined ? null : Math.floor(this.now() / 1000) + options.expirationTtl);
        this.sql.exec('INSERT INTO oauth_records(key, value, expires, metadata) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires=excluded.expires, metadata=excluded.metadata',
            key, value, expires, options?.metadata === undefined ? null : JSON.stringify(options.metadata));
    }

    setGrantRevocationHook(hook: (owner: string) => Promise<unknown>): void { this.grantRevocationHook = hook; }

    async drainGrantRevocations(limit = 25): Promise<{ delivered: number; failed: number }> {
        let delivered = 0, failed = 0;
        if (!this.grantRevocationHook) return { delivered, failed };
        const rows = [...this.sql.exec('SELECT owner FROM oauth_grant_revocations ORDER BY rowid LIMIT ?', Math.max(1, Math.min(100, limit)))];
        for (const row of rows) {
            try {
                await this.grantRevocationHook(String(row.owner));
                this.sql.exec('DELETE FROM oauth_grant_revocations WHERE owner = ?', String(row.owner));
                delivered++;
            } catch { failed++; }
        }
        return { delivered, failed };
    }

    async delete(key: string): Promise<void> {
        this.sql.exec('DELETE FROM oauth_records WHERE key = ?', key);
        if (key.startsWith('grant:')) {
            try { await this.drainGrantRevocations(1); } catch { /* Durable outbox delivery cannot undo OAuth revocation. */ }
        }
    }

    async list<M = unknown>(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
        const prefix = options.prefix ?? '';
        const limit = Math.min(1000, Math.max(1, options.limit ?? 1000));
        const after = options.cursor ? decodeURIComponent(options.cursor) : '';
        const rows = [...this.sql.exec('SELECT key, expires, metadata FROM oauth_records WHERE substr(key, 1, ?) = ? AND key > ? AND (expires IS NULL OR expires > ?) ORDER BY key LIMIT ?',
            prefix.length, prefix, after, Math.floor(this.now() / 1000), limit + 1)];
        const selected = rows.slice(0, limit);
        return {
            keys: selected.map((row) => ({ name: String(row.key),
                ...(row.expires === null ? {} : { expiration: Number(row.expires) }),
                ...(row.metadata === null ? {} : { metadata: JSON.parse(String(row.metadata)) as M }),
            })),
            list_complete: rows.length <= limit,
            cursor: rows.length > limit ? encodeURIComponent(String(selected.at(-1)!.key)) : '',
            cacheStatus: null,
        };
    }

    purgeExpired(): void { this.sql.exec('DELETE FROM oauth_records WHERE expires <= ?', Math.floor(this.now() / 1000)); }
}

import type { SqlDatabase } from './sql';
import { ServiceError } from '../../domain/errors';

export class SqliteRateLimits {
    constructor(private readonly sql: SqlDatabase, private readonly now: () => number = Date.now) {
        sql.exec('CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, period INTEGER NOT NULL, count INTEGER NOT NULL)');
        sql.exec('CREATE INDEX IF NOT EXISTS request_limits_period ON request_limits(period)');
    }
    consume(key: string, limit = 10) {
        const period = Math.floor(this.now() / 300_000);
        const changed = Array.from(this.sql.exec(`INSERT INTO request_limits (key, period, count) VALUES (?, ?, 1)
            ON CONFLICT(key) DO UPDATE SET period = excluded.period, count = CASE WHEN period = excluded.period THEN count + 1 ELSE 1 END
            WHERE period != excluded.period OR count < ? RETURNING count`, key, period, limit));
        if (!changed.length) throw new ServiceError('RATE_LIMITED', 'Too many registration attempts. Try again later.', 429);
    }
    cleanup() { this.sql.exec('DELETE FROM request_limits WHERE period < ?', Math.floor(this.now() / 300_000)); }
}

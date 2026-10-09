import { publicEventPayload } from '../../domain/event-payload';
import type { EventInbox, InboxEvent, EventPage } from '../../ports/events';
import type { SqlDatabase } from './sql';
import { ServiceError } from '../../domain/errors';

export class SqliteEventInbox implements EventInbox {
    constructor(private readonly sql: SqlDatabase, private readonly now: () => number = Date.now,
        private readonly limits = { maxEvents: 10_000, maxBytes: 64 * 1024 * 1024 }) {
        sql.exec('CREATE TABLE IF NOT EXISTS event_settings (profile TEXT PRIMARY KEY, value TEXT NOT NULL)');
        sql.exec('CREATE TABLE IF NOT EXISTS event_inbox (sequence INTEGER PRIMARY KEY AUTOINCREMENT, profile TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, bytes INTEGER NOT NULL, expires INTEGER NOT NULL, UNIQUE(profile, id))');
        sql.exec('CREATE INDEX IF NOT EXISTS event_profile_cursor ON event_inbox(profile, sequence)');
        sql.exec('CREATE INDEX IF NOT EXISTS event_expiry ON event_inbox(expires)');
    }
    async append(profile: string, event: InboxEvent) {
        if (Array.from(this.sql.exec('SELECT id FROM event_inbox WHERE profile = ? AND id = ?', profile, event.id)).length) return false;
        const payload = JSON.stringify(publicEventPayload(event.payload));
        const bytes = new TextEncoder().encode(payload).byteLength;
        const result = Array.from(this.sql.exec(`INSERT INTO event_inbox (profile, id, type, payload, bytes, expires)
            SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM event_inbox WHERE profile = ?) < ?
            AND (SELECT COALESCE(SUM(bytes), 0) FROM event_inbox) + ? <= ? RETURNING sequence`,
        profile, event.id, event.type, payload, bytes, this.now() + 86400_000, profile, this.limits.maxEvents, bytes, this.limits.maxBytes));
        if (!result.length) throw new ServiceError('EVENT_CAPACITY', 'The event inbox is full.', 503);
        return true;
    }
    async read(profile: string, cursor: number, limit: number): Promise<EventPage> {
        if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
            throw new ServiceError('INVALID_PAGINATION', 'Invalid event cursor or limit.');
        }
        const events = Array.from(this.sql.exec('SELECT * FROM event_inbox WHERE profile = ? AND sequence > ? AND expires > ? ORDER BY sequence LIMIT ?', profile, cursor, this.now(), limit),
            (row) => ({ id: String(row.id), type: String(row.type), sequence: Number(row.sequence), payload: publicEventPayload(JSON.parse(String(row.payload)) as Record<string, unknown>) }));
        return { events, cursor: events.at(-1)?.sequence ?? cursor };
    }
    async tail(profile: string): Promise<number> { return Number([...this.sql.exec('SELECT COALESCE(MAX(sequence),0) AS cursor FROM event_inbox WHERE profile = ?', profile)][0]?.cursor ?? 0); }
    async getSettings(profile: string) {
        const value = Array.from(this.sql.exec('SELECT value FROM event_settings WHERE profile = ?', profile))[0]?.value;
        return value === undefined ? undefined : String(value);
    }
    async putSettings(profile: string, encrypted: string) {
        this.sql.exec('INSERT INTO event_settings (profile, value) VALUES (?, ?) ON CONFLICT(profile) DO UPDATE SET value = excluded.value', profile, encrypted);
    }
    async removeProfile(profile: string) {
        this.sql.exec('DELETE FROM event_settings WHERE profile = ?', profile);
        this.sql.exec('DELETE FROM event_inbox WHERE profile = ?', profile);
    }
    async cleanup() { this.sql.exec('DELETE FROM event_inbox WHERE expires <= ?', this.now()); }
}

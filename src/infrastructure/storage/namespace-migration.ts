import { hash } from '../crypto/secret-box';
import { ServiceError } from '../../domain/errors';

type Cell = string | number | null;
interface TableSnapshot { name: string; columns: string[]; rows: Cell[][] }
export interface StorageSnapshot { tables: TableSnapshot[]; digest: string }
const tables = [
    'artifact_budget', 'artifacts', 'credential_accounts', 'credential_flows',
    'credential_profiles', 'event_inbox', 'event_settings', 'oauth_records',
    'request_limits', 'sqlite_sequence',
];
const identifier = (value: string) => {
    if (!/^[a-z_]+$/u.test(value)) throw new Error('Invalid migration identifier');
    return `"${value}"`;
};
const MAX_ROWS = 100_000;
const MAX_BYTES = 32 * 1024 * 1024;

export class StorageMigration {
    constructor(private readonly storage: DurableObjectStorage) {
        storage.sql.exec('CREATE TABLE IF NOT EXISTS namespace_migration (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    }

    isFrozen() { return [...this.storage.sql.exec("SELECT value FROM namespace_migration WHERE key = 'frozen'")].length > 0; }

    assertActive() {
        if (this.isFrozen()) {
            throw new ServiceError('MAINTENANCE', 'Storage maintenance is in progress. Retry shortly.', 503);
        }
    }

    async freeze() {
        this.storage.sql.exec("INSERT OR REPLACE INTO namespace_migration VALUES ('frozen', 'true')");
        await this.storage.deleteAlarm();
    }

    resume() { this.storage.sql.exec("DELETE FROM namespace_migration WHERE key = 'frozen'"); }

    async snapshot(): Promise<StorageSnapshot> {
        const available = new Set([...this.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'")].map((row) => row.name));
        const result: TableSnapshot[] = [];
        let count = 0;
        for (const name of tables.filter((table) => available.has(table))) {
            const columns = [...this.storage.sql.exec(`PRAGMA table_info(${identifier(name)})`)].map((row) => String(row.name));
            const rows: Cell[][] = [];
            for (const row of this.storage.sql.exec(`SELECT * FROM ${identifier(name)} ORDER BY rowid`)) {
                if (++count > MAX_ROWS) throw new Error('Migration row limit exceeded');
                rows.push(columns.map((column) => {
                    const value = row[column];
                    if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw new Error('Unsupported migration cell');
                    return value;
                }));
            }
            result.push({ name, columns, rows });
        }
        const encoded = JSON.stringify(result);
        if (new TextEncoder().encode(encoded).length > MAX_BYTES) throw new Error('Migration size limit exceeded');
        return { tables: result, digest: await hash(encoded) };
    }

    async restore(snapshot: StorageSnapshot) {
        if (await hash(JSON.stringify(snapshot.tables)) !== snapshot.digest) throw new Error('Migration digest mismatch');
        const current = await this.snapshot();
        if (current.digest === snapshot.digest) return;
        if (current.tables.some((table) => table.rows.length)) throw new Error('Migration destination is not empty');
        if (JSON.stringify(current.tables.map(({ name, columns }) => ({ name, columns }))) !==
            JSON.stringify(snapshot.tables.map(({ name, columns }) => ({ name, columns })))) throw new Error('Migration schema mismatch');
        this.storage.transactionSync(() => {
            for (const table of snapshot.tables) {
                if (table.name === 'sqlite_sequence') this.storage.sql.exec('DELETE FROM sqlite_sequence');
                for (const row of table.rows) {
                    if (row.length !== table.columns.length) throw new Error('Migration row width mismatch');
                    this.storage.sql.exec(`INSERT INTO ${identifier(table.name)} (${table.columns.map(identifier).join(',')}) VALUES (${row.map(() => '?').join(',')})`, ...row);
                }
            }
        });
        const copied = await this.snapshot();
        if (copied.digest !== snapshot.digest) throw new Error('Migration verification failed');
    }
}

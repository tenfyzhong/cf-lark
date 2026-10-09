import type { CredentialStore, StoredAccount, StoredFlow, StoredProfile } from '../../ports/credentials';
import type { SqlDatabase } from './sql';

export class SqliteCredentialStore implements CredentialStore {
    constructor(private readonly sql: SqlDatabase) {
        sql.exec('CREATE TABLE IF NOT EXISTS credential_profiles (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
        sql.exec('CREATE TABLE IF NOT EXISTS credential_accounts (profile TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (profile, id))');
        sql.exec('CREATE TABLE IF NOT EXISTS credential_flows (id TEXT PRIMARY KEY, profile TEXT NOT NULL, value TEXT NOT NULL)');
        sql.exec('CREATE INDEX IF NOT EXISTS credential_flows_profile ON credential_flows(profile)');
        sql.exec(`CREATE TRIGGER IF NOT EXISTS credential_profile_deleted AFTER DELETE ON credential_profiles BEGIN
            DELETE FROM credential_accounts WHERE profile = OLD.id;
            DELETE FROM credential_flows WHERE profile = OLD.id;
        END`);
    }

    private values<T>(query: string, ...bindings: string[]): T[] {
        return Array.from(this.sql.exec(query, ...bindings), (row) => JSON.parse(String(row.value)) as T);
    }

    async getProfile(id: string) { return this.values<StoredProfile>('SELECT value FROM credential_profiles WHERE id = ?', id)[0]; }
    async listProfiles() { return this.values<StoredProfile>('SELECT value FROM credential_profiles ORDER BY id'); }
    async putProfile(profile: StoredProfile) {
        this.sql.exec('INSERT INTO credential_profiles (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value', profile.id, JSON.stringify(profile));
    }
    async deleteProfile(id: string) { this.sql.exec('DELETE FROM credential_profiles WHERE id = ?', id); }
    async getAccount(profile: string, id: string) {
        return this.values<StoredAccount>('SELECT value FROM credential_accounts WHERE profile = ? AND id = ?', profile, id)[0];
    }
    async listAccounts(profile: string) { return this.values<StoredAccount>('SELECT value FROM credential_accounts WHERE profile = ? ORDER BY id', profile); }
    async putAccount(account: StoredAccount) {
        this.sql.exec('INSERT INTO credential_accounts (profile, id, value) VALUES (?, ?, ?) ON CONFLICT(profile, id) DO UPDATE SET value = excluded.value', account.profileId, account.id, JSON.stringify(account));
    }
    async deleteAccount(profile: string, id: string) { this.sql.exec('DELETE FROM credential_accounts WHERE profile = ? AND id = ?', profile, id); }
    async getFlow(id: string) { return this.values<StoredFlow>('SELECT value FROM credential_flows WHERE id = ?', id)[0]; }
    async putFlow(flow: StoredFlow) {
        this.sql.exec('INSERT INTO credential_flows (id, profile, value) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET profile = excluded.profile, value = excluded.value', flow.id, flow.profileId, JSON.stringify(flow));
    }
}

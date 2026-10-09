import type { CredentialStore, StoredAccount, StoredFlow, StoredProfile } from '../../src/ports/credentials';

export class MemoryCredentialStore implements CredentialStore {
    private profiles = new Map<string, StoredProfile>();
    private accounts = new Map<string, StoredAccount>();
    private flows = new Map<string, StoredFlow>();
    async getProfile(id: string) { return structuredClone(this.profiles.get(id)); }
    async listProfiles() { return structuredClone([...this.profiles.values()]); }
    async putProfile(profile: StoredProfile) { this.profiles.set(profile.id, structuredClone(profile)); }
    async deleteProfile(id: string) {
        this.profiles.delete(id);
        for (const [key, value] of this.accounts) if (value.profileId === id) this.accounts.delete(key);
        for (const [key, value] of this.flows) if (value.profileId === id) this.flows.delete(key);
    }
    async getAccount(profile: string, id: string) { return structuredClone(this.accounts.get(`${profile}:${id}`)); }
    async listAccounts(profile: string) { return structuredClone([...this.accounts.values()].filter((value) => value.profileId === profile)); }
    async putAccount(account: StoredAccount) { this.accounts.set(`${account.profileId}:${account.id}`, structuredClone(account)); }
    async deleteAccount(profile: string, id: string) { this.accounts.delete(`${profile}:${id}`); }
    async getFlow(id: string) { return structuredClone(this.flows.get(id)); }
    async putFlow(flow: StoredFlow) { this.flows.set(flow.id, structuredClone(flow)); }
}

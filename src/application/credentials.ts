import { ServiceError } from '../domain/errors';
import type { Brand, Identity, Profile } from '../domain/models';
import type { AppCredentials, CredentialStore, Encryption, StoredFlow, StoredProfile, UpstreamAuth, UpstreamToken } from '../ports/credentials';

function publicProfile(profile: StoredProfile): Profile {
    const { id, name, brand, appId, generation, createdAt } = profile;
    return { id, name, brand, appId, generation, createdAt };
}

function publicFlow(flow: StoredFlow) {
    const { id, profileId, verificationUri, expiresAt, interval, nextPollAt, status, accountId } = flow;
    return { id, profileId, verificationUri, expiresAt, interval, nextPollAt, status, accountId };
}

export class CredentialService {
    private readonly inFlight = new Map<string, Promise<string>>();

    constructor(
        private readonly store: CredentialStore,
        private readonly encryption: Encryption,
        private readonly upstream: UpstreamAuth,
        private readonly now: () => number = Date.now,
    ) {}

    async create(input: { name: string; brand: Brand; appId: string; appSecret: string }): Promise<Profile> {
        if (!input.name?.trim() || !input.appId?.trim() || !input.appSecret || !['feishu', 'lark'].includes(input.brand)) {
            throw new ServiceError('INVALID_PROFILE', 'Name, brand, application ID, and application secret are required.');
        }
        const id = crypto.randomUUID();
        const profile: StoredProfile = { id, name: input.name, brand: input.brand, appId: input.appId,
            generation: 1, createdAt: this.now(), secret: await this.encryption.encrypt(`profile:${id}`, input.appSecret) };
        await this.store.putProfile(profile);
        return publicProfile(profile);
    }

    async list(): Promise<Profile[]> { return (await this.store.listProfiles()).map(publicProfile); }
    async get(id: string): Promise<Profile> { return publicProfile(await this.requireProfile(id)); }
    async remove(id: string): Promise<void> { await this.store.deleteProfile(id); }

    async update(id: string, input: { name?: string; appSecret?: string }): Promise<Profile> {
        const profile = await this.requireProfile(id);
        if (input.name !== undefined) {
            if (!input.name.trim()) throw new ServiceError('INVALID_PROFILE', 'Profile name cannot be empty.');
            profile.name = input.name;
        }
        if (input.appSecret !== undefined) {
            if (!input.appSecret) throw new ServiceError('INVALID_PROFILE', 'Application secret cannot be empty.');
            profile.secret = await this.encryption.encrypt(`profile:${id}`, input.appSecret);
            profile.generation++;
            delete profile.tenantToken;
            delete profile.tenantExpiresAt;
        }
        await this.store.putProfile(profile);
        return publicProfile(profile);
    }

    async accounts(profileId: string) {
        await this.requireProfile(profileId);
        return (await this.store.listAccounts(profileId)).map(({ id, name, scopes, expiresAt, refreshExpiresAt }) => ({ id, name, scopes, expiresAt, refreshExpiresAt }));
    }

    async beginLogin(profileId: string) {
        const profile = await this.requireProfile(profileId);
        const app = await this.app(profile);
        const scopes = await this.upstream.appUserScopes(app);
        const result = await this.upstream.beginDevice(app, [...new Set([...scopes, 'offline_access'])]);
        const id = crypto.randomUUID();
        const interval = Math.max(1, result.interval || 5) * 1000;
        const flow: StoredFlow = {
            id, profileId, generation: profile.generation,
            deviceCode: await this.encryption.encrypt(`flow:${id}`, result.device_code),
            verificationUri: result.verification_uri_complete || result.verification_uri,
            expiresAt: this.now() + result.expires_in * 1000, interval,
            nextPollAt: this.now() + interval, status: 'pending',
        };
        await this.store.putFlow(flow);
        return publicFlow(flow);
    }

    async flow(id: string) { return publicFlow(await this.requireFlow(id)); }
    async cancelLogin(id: string) {
        const flow = await this.requireFlow(id);
        flow.status = 'cancelled';
        flow.deviceCode = '';
        await this.store.putFlow(flow);
    }

    async pollLogin(id: string) {
        const flow = await this.requireFlow(id);
        if (flow.status !== 'pending') throw new ServiceError('FLOW_INACTIVE', 'The authorization flow is no longer pending.');
        const profile = await this.requireProfile(flow.profileId);
        if (profile.generation !== flow.generation) throw new ServiceError('FLOW_INVALIDATED', 'Application credentials changed; start a new authorization.');
        if (flow.expiresAt <= this.now()) {
            flow.status = 'expired'; flow.deviceCode = '';
            await this.store.putFlow(flow);
            return publicFlow(flow);
        }
        if (flow.nextPollAt > this.now()) throw new ServiceError('POLL_TOO_EARLY', 'Wait until the next polling interval.', 429, { nextPollAt: flow.nextPollAt });
        flow.nextPollAt = this.now() + flow.interval;
        await this.store.putFlow(flow);
        const result = await this.upstream.pollDevice(await this.app(profile), await this.encryption.decrypt(`flow:${id}`, flow.deviceCode));
        if ('error' in result) {
            if (result.error === 'slow_down') {
                flow.interval = Math.min(60_000, flow.interval + 5000);
                flow.nextPollAt = this.now() + flow.interval;
            } else if (result.error !== 'authorization_pending') {
                flow.status = result.error === 'access_denied' ? 'denied' : 'expired';
                flow.deviceCode = '';
            }
        } else {
            const user = await this.upstream.userInfo(profile.brand, result.access_token);
            if (!user.open_id) throw new ServiceError('INVALID_ACCOUNT', 'The upstream response did not identify an account.', 502);
            const current = await this.requireFlow(id);
            if (current.status !== 'pending' || (await this.requireProfile(profile.id)).generation !== profile.generation) {
                throw new ServiceError('FLOW_INVALIDATED', 'Authorization was cancelled or its credentials changed.');
            }
            await this.saveAccount(profile.id, user.open_id, user.name ?? user.open_id, result);
            flow.status = 'authorized'; flow.accountId = user.open_id; flow.deviceCode = '';
        }
        await this.store.putFlow(flow);
        return publicFlow(flow);
    }

    async logout(profileId: string, accountId: string): Promise<void> {
        const profile = await this.requireProfile(profileId);
        const account = await this.store.getAccount(profileId, accountId);
        await this.store.deleteAccount(profileId, accountId);
        if (account) {
            const token = await this.encryption.decrypt(`account:${profileId}:${accountId}:access`, account.accessToken);
            await this.upstream.revoke(await this.app(profile), token);
        }
    }

    async token(profileId: string, identity: Identity, accountId?: string): Promise<string> {
        if (identity !== 'user' && identity !== 'bot') throw new ServiceError('INVALID_IDENTITY', 'Identity must be user or bot.');
        const key = JSON.stringify([profileId, identity, accountId]);
        const existing = this.inFlight.get(key);
        if (existing) return existing;
        const operation = this.resolveToken(profileId, identity, accountId);
        this.inFlight.set(key, operation);
        try { return await operation; } finally { if (this.inFlight.get(key) === operation) this.inFlight.delete(key); }
    }

    private async resolveToken(profileId: string, identity: Identity, accountId?: string): Promise<string> {
        const profile = await this.requireProfile(profileId);
        if (identity === 'bot') {
            if (profile.tenantToken && (profile.tenantExpiresAt ?? 0) > this.now() + 60_000) {
                return this.encryption.decrypt(`tenant:${profileId}`, profile.tenantToken);
            }
            const result = await this.upstream.tenantToken(await this.app(profile));
            await this.assertGeneration(profile);
            profile.tenantToken = await this.encryption.encrypt(`tenant:${profileId}`, result.tenant_access_token);
            profile.tenantExpiresAt = this.now() + result.expire * 1000;
            await this.store.putProfile(profile);
            return result.tenant_access_token;
        }
        const account = accountId ? await this.store.getAccount(profileId, accountId) : undefined;
        if (!account || !accountId) throw new ServiceError('LOGIN_REQUIRED', 'Authorize this user account before execution.', 401);
        const prefix = `account:${profileId}:${accountId}`;
        if (account.expiresAt > this.now() + 60_000) return this.encryption.decrypt(`${prefix}:access`, account.accessToken);
        if (account.refreshExpiresAt <= this.now() || !account.refreshToken) throw new ServiceError('LOGIN_REQUIRED', 'User authorization expired; sign in again.', 401);
        const refreshToken = await this.encryption.decrypt(`${prefix}:refresh`, account.refreshToken);
        const result = await this.upstream.refresh(await this.app(profile), refreshToken);
        await this.assertGeneration(profile);
        if (!(await this.store.getAccount(profileId, accountId))) throw new ServiceError('LOGIN_REQUIRED', 'The account was signed out.', 401);
        await this.saveAccount(profileId, accountId, account.name, {
            ...result, refresh_token: result.refresh_token || refreshToken,
            refresh_token_expires_in: result.refresh_token_expires_in ?? Math.max(0, (account.refreshExpiresAt - this.now()) / 1000),
            scope: result.scope ?? account.scopes.join(' '),
        });
        return result.access_token;
    }

    private async saveAccount(profileId: string, id: string, name: string, token: UpstreamToken) {
        const prefix = `account:${profileId}:${id}`;
        await this.store.putAccount({ id, profileId, name,
            accessToken: await this.encryption.encrypt(`${prefix}:access`, token.access_token),
            refreshToken: token.refresh_token ? await this.encryption.encrypt(`${prefix}:refresh`, token.refresh_token) : '',
            expiresAt: this.now() + token.expires_in * 1000,
            refreshExpiresAt: this.now() + (token.refresh_token_expires_in ?? token.expires_in) * 1000,
            scopes: token.scope?.split(/\s+/u).filter(Boolean) ?? [],
        });
    }

    private async app(profile: StoredProfile): Promise<AppCredentials> {
        return { brand: profile.brand, appId: profile.appId, appSecret: await this.encryption.decrypt(`profile:${profile.id}`, profile.secret) };
    }
    private async requireProfile(id: string): Promise<StoredProfile> {
        const profile = await this.store.getProfile(id);
        if (!profile) throw new ServiceError('PROFILE_NOT_FOUND', 'Application profile not found.', 404);
        return profile;
    }
    private async requireFlow(id: string): Promise<StoredFlow> {
        const flow = await this.store.getFlow(id);
        if (!flow) throw new ServiceError('FLOW_NOT_FOUND', 'Authorization flow not found.', 404);
        return flow;
    }
    private async assertGeneration(profile: StoredProfile) {
        if ((await this.requireProfile(profile.id)).generation !== profile.generation) {
            throw new ServiceError('CREDENTIALS_CHANGED', 'Credentials changed while the request was running.', 409);
        }
    }
}

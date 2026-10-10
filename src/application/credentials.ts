import { ServiceError } from '../domain/errors';
import type { Brand, ExecutionSelection, Identity, Profile } from '../domain/models';
import type { AuthorizationSnapshot } from '../ports/auth-diagnostics';
import type { AccessAuthorization, AppCredentials, CredentialStore, DeviceAuthorizationState, Encryption, StoredAccount, StoredFlow, StoredProfile, TokenAuthorization, UpstreamAuth, UpstreamToken } from '../ports/credentials';

function publicProfile(profile: StoredProfile): Profile {
    const { id, name, brand, appId, generation, createdAt } = profile;
    return { id, name, brand, appId, generation, createdAt };
}

function publicFlow(flow: StoredFlow) {
    const { id, profileId, verificationUri, expiresAt, interval, nextPollAt, status, accountId } = flow;
    return { id, profileId, verificationUri, expiresAt, interval, nextPollAt, status, accountId };
}

export class CredentialService {
    private readonly inFlight = new Map<string, Promise<AccessAuthorization>>();

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

    async inspectAuthorization(selection: ExecutionSelection): Promise<AuthorizationSnapshot> {
        const profile = await this.store.getProfile(selection.profileId);
        if (!profile) return { profileExists: false, credentialStatus: 'missing' };
        if (selection.identity === 'bot') return { profileExists: true, credentialStatus: profile.tenantToken ? 'present' : 'missing',
            ...(profile.tenantExpiresAt === undefined ? {} : { expiresAt: profile.tenantExpiresAt }), tokenType: 'Bearer', bindingStatus: 'unbound' };
        const account = selection.accountId ? await this.store.getAccount(selection.profileId, selection.accountId) : undefined;
        if (!account) return { profileExists: true, credentialStatus: 'missing' };
        return { profileExists: true, credentialStatus: account.accessToken ? 'present' : 'missing', expiresAt: account.expiresAt,
            refreshExpiresAt: account.refreshExpiresAt, scopes: [...account.scopes], tokenType: account.tokenType ?? 'Bearer',
            bindingStatus: account.tokenType === 'DPoP' ? account.authorization ? 'bound' : 'missing_key' : 'unbound' };
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
            ...(result.authorization ? { authorization: await this.encryption.encrypt(`flow:${id}:authorization`, JSON.stringify(result.authorization)) } : {}),
        };
        await this.store.putFlow(flow);
        return publicFlow(flow);
    }

    async flow(id: string) { return publicFlow(await this.requireFlow(id)); }
    async cancelLogin(id: string) {
        const flow = await this.requireFlow(id);
        flow.status = 'cancelled';
        flow.deviceCode = ''; delete flow.authorization;
        await this.store.putFlow(flow);
    }

    async pollLogin(id: string) {
        const flow = await this.requireFlow(id);
        if (flow.status !== 'pending') throw new ServiceError('FLOW_INACTIVE', 'The authorization flow is no longer pending.');
        const profile = await this.requireProfile(flow.profileId);
        if (profile.generation !== flow.generation) {
            flow.status = 'cancelled'; flow.deviceCode = ''; delete flow.authorization;
            await this.store.putFlow(flow);
            throw new ServiceError('FLOW_INVALIDATED', 'Application credentials changed; start a new authorization.');
        }
        if (flow.expiresAt <= this.now()) {
            flow.status = 'expired'; flow.deviceCode = ''; delete flow.authorization;
            await this.store.putFlow(flow);
            return publicFlow(flow);
        }
        if (flow.nextPollAt > this.now()) throw new ServiceError('POLL_TOO_EARLY', 'Wait until the next polling interval.', 429, { nextPollAt: flow.nextPollAt });
        flow.nextPollAt = this.now() + flow.interval;
        await this.store.putFlow(flow);
        let state: DeviceAuthorizationState | undefined;
        if (flow.authorization) {
            try { state = JSON.parse(await this.encryption.decrypt(`flow:${id}:authorization`, flow.authorization)) as DeviceAuthorizationState; }
            catch { throw new ServiceError('DPOP_KEY_MISSING', 'The authorization flow proof state is unavailable; start authorization again.', 401); }
        }
        const result = await this.upstream.pollDevice(await this.app(profile), await this.encryption.decrypt(`flow:${id}`, flow.deviceCode), state);
        if ('error' in result) {
            if (result.error === 'slow_down') {
                flow.interval = Math.min(60_000, flow.interval + 5000);
                flow.nextPollAt = this.now() + flow.interval;
            } else if (result.error !== 'authorization_pending') {
                flow.status = result.error === 'access_denied' ? 'denied' : 'expired';
                flow.deviceCode = ''; delete flow.authorization;
            }
        } else {
            const user = await this.upstream.userInfo(profile.brand, result.access_token, result.authorization);
            if (!user.open_id) throw new ServiceError('INVALID_ACCOUNT', 'The upstream response did not identify an account.', 502);
            const current = await this.requireFlow(id);
            if (current.status !== 'pending' || (await this.requireProfile(profile.id)).generation !== profile.generation) {
                throw new ServiceError('FLOW_INVALIDATED', 'Authorization was cancelled or its credentials changed.');
            }
            await this.saveAccount(profile.id, user.open_id, user.name ?? user.open_id, result);
            flow.status = 'authorized'; flow.accountId = user.open_id; flow.deviceCode = ''; delete flow.authorization;
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
            await this.upstream.revoke(await this.app(profile), token, await this.accountAuthorization(account));
        }
    }

    async token(profileId: string, identity: Identity, accountId?: string): Promise<string> {
        const authorization = await this.authorization(profileId, identity, accountId);
        if (authorization.tokenType === 'DPoP') throw new ServiceError('DPOP_REQUIRED', 'A bound credential must be used through the proof-aware transport.', 401);
        return authorization.accessToken;
    }

    async authorization(profileId: string, identity: Identity, accountId?: string): Promise<AccessAuthorization> {
        if (identity !== 'user' && identity !== 'bot') throw new ServiceError('INVALID_IDENTITY', 'Identity must be user or bot.');
        const key = JSON.stringify([profileId, identity, accountId]);
        const existing = this.inFlight.get(key);
        if (existing) return existing;
        const operation = this.resolveToken(profileId, identity, accountId);
        this.inFlight.set(key, operation);
        try { return await operation; } finally { if (this.inFlight.get(key) === operation) this.inFlight.delete(key); }
    }

    private async resolveToken(profileId: string, identity: Identity, accountId?: string): Promise<AccessAuthorization> {
        const profile = await this.requireProfile(profileId);
        if (identity === 'bot') {
            if (profile.tenantToken && (profile.tenantExpiresAt ?? 0) > this.now() + 60_000) {
                return { accessToken: await this.encryption.decrypt(`tenant:${profileId}`, profile.tenantToken), tokenType: 'Bearer' };
            }
            const result = await this.upstream.tenantToken(await this.app(profile));
            await this.assertGeneration(profile);
            profile.tenantToken = await this.encryption.encrypt(`tenant:${profileId}`, result.tenant_access_token);
            profile.tenantExpiresAt = this.now() + result.expire * 1000;
            await this.store.putProfile(profile);
            return { accessToken: result.tenant_access_token, tokenType: 'Bearer' };
        }
        const account = accountId ? await this.store.getAccount(profileId, accountId) : undefined;
        if (!account || !accountId) throw new ServiceError('LOGIN_REQUIRED', 'Authorize this user account before execution.', 401);
        const prefix = `account:${profileId}:${accountId}`;
        const authorization = await this.accountAuthorization(account);
        if (this.upstream.options?.dpopMode === 'required' && authorization.tokenType !== 'DPoP') {
            throw new ServiceError('DPOP_REQUIRED', 'This deployment requires a bound user credential; authorize again.', 401);
        }
        if (account.expiresAt > this.now() + 60_000) return { accessToken: await this.encryption.decrypt(`${prefix}:access`, account.accessToken),
            tokenType: authorization.tokenType, ...(authorization.dpopKey ? { dpopKey: authorization.dpopKey } : {}) };
        if (account.refreshExpiresAt <= this.now() || !account.refreshToken) throw new ServiceError('LOGIN_REQUIRED', 'User authorization expired; sign in again.', 401);
        const refreshToken = await this.encryption.decrypt(`${prefix}:refresh`, account.refreshToken);
        const result = await this.upstream.refresh(await this.app(profile), refreshToken, authorization);
        await this.assertGeneration(profile);
        const current = await this.store.getAccount(profileId, accountId);
        if (!current || current.accessToken !== account.accessToken || current.authorization !== account.authorization) throw new ServiceError('LOGIN_REQUIRED', 'The account authorization changed while refreshing; retry.', 401);
        if (authorization.tokenType === 'DPoP' && (result.authorization?.tokenType !== 'DPoP' || result.authorization.dpopKey?.jkt !== authorization.dpopKey?.jkt)) {
            throw new ServiceError('DPOP_BINDING_MISMATCH', 'Refresh did not preserve the proof binding; the stored credential was preserved.', 401);
        }
        await this.saveAccount(profileId, accountId, account.name, {
            ...result, refresh_token: result.refresh_token || refreshToken,
            refresh_token_expires_in: result.refresh_token_expires_in ?? Math.max(0, (account.refreshExpiresAt - this.now()) / 1000),
            scope: result.scope ?? account.scopes.join(' '),
            authorization: result.authorization ?? authorization,
        });
        return { accessToken: result.access_token, tokenType: result.authorization?.tokenType ?? authorization.tokenType,
            ...(result.authorization?.dpopKey ?? authorization.dpopKey ? { dpopKey: result.authorization?.dpopKey ?? authorization.dpopKey } : {}) };
    }

    private async saveAccount(profileId: string, id: string, name: string, token: UpstreamToken) {
        const prefix = `account:${profileId}:${id}`;
        if (token.token_type === 'DPoP' && (token.authorization?.tokenType !== 'DPoP' || !token.authorization.dpopKey)) {
            throw new ServiceError('DPOP_KEY_MISSING', 'A bound credential cannot be saved without its proof key.', 401);
        }
        await this.store.putAccount({ id, profileId, name,
            accessToken: await this.encryption.encrypt(`${prefix}:access`, token.access_token),
            refreshToken: token.refresh_token ? await this.encryption.encrypt(`${prefix}:refresh`, token.refresh_token) : '',
            expiresAt: this.now() + token.expires_in * 1000,
            refreshExpiresAt: this.now() + (token.refresh_token_expires_in ?? token.expires_in) * 1000,
            scopes: token.scope?.split(/\s+/u).filter(Boolean) ?? [],
            ...(token.authorization ? { tokenType: token.authorization.tokenType, oauthProtocol: token.authorization.protocol,
                authorization: await this.encryption.encrypt(`${prefix}:authorization`, JSON.stringify(token.authorization)) } : {}),
        });
    }

    private async accountAuthorization(account: StoredAccount): Promise<TokenAuthorization> {
        if (!account.authorization) {
            if (account.tokenType === 'DPoP') throw new ServiceError('DPOP_KEY_MISSING', 'The bound credential proof key is missing; authorize again.', 401);
            return { protocol: account.oauthProtocol ?? 'legacy', tokenType: 'Bearer' };
        }
        let authorization: TokenAuthorization;
        try { authorization = JSON.parse(await this.encryption.decrypt(`account:${account.profileId}:${account.id}:authorization`, account.authorization)) as TokenAuthorization; }
        catch { throw new ServiceError('DPOP_KEY_MISSING', 'The credential proof state is unavailable; authorize again.', 401); }
        if (!authorization || authorization.protocol !== (account.oauthProtocol ?? 'legacy') || authorization.tokenType !== (account.tokenType ?? 'Bearer')
            || !['legacy', 'oauthv3'].includes(authorization.protocol) || !['Bearer', 'DPoP'].includes(authorization.tokenType)
            || authorization.tokenType === 'Bearer' && authorization.dpopKey || authorization.tokenType === 'DPoP' && authorization.protocol !== 'oauthv3') {
            throw new ServiceError('DPOP_BINDING_MISMATCH', 'The stored credential proof metadata is inconsistent; authorize again.', 401);
        }
        if (authorization.tokenType === 'DPoP' && (!authorization.dpopKey?.privateJwk || !authorization.dpopKey.jkt)) {
            throw new ServiceError('DPOP_KEY_MISSING', 'The bound credential proof key is missing; authorize again.', 401);
        }
        return authorization;
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

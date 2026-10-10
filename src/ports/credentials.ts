import type { Brand, Profile } from '../domain/models';

export interface Encryption {
    encrypt(recordId: string, value: string): Promise<string>;
    decrypt(recordId: string, ciphertext: string): Promise<string>;
}

export interface StoredProfile extends Profile {
    secret: string;
    tenantToken?: string;
    tenantExpiresAt?: number;
}

export type OAuthProtocol = 'legacy' | 'oauthv3';
export type DpopMode = 'disabled' | 'preferred' | 'required';
export interface OAuthOptions { protocol: OAuthProtocol; dpopMode: DpopMode }
/** Private signing material. Encrypt before persistence; never include in public output. */
export interface DpopKey { privateJwk: string; jkt: string }
export interface DeviceAuthorizationState extends OAuthOptions { dpopKey?: DpopKey }
export interface TokenAuthorization {
    protocol: OAuthProtocol;
    tokenType: 'Bearer' | 'DPoP';
    dpopKey?: DpopKey;
}
export interface AccessAuthorization {
    accessToken: string;
    tokenType: 'Bearer' | 'DPoP';
    dpopKey?: DpopKey;
}

export interface StoredAccount {
    id: string;
    profileId: string;
    name: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    refreshExpiresAt: number;
    scopes: string[];
    tokenType?: 'Bearer' | 'DPoP';
    oauthProtocol?: OAuthProtocol;
    /** Encrypted TokenAuthorization, bound to the account record. */
    authorization?: string;
}

export interface StoredFlow {
    id: string;
    profileId: string;
    generation: number;
    deviceCode: string;
    verificationUri: string;
    expiresAt: number;
    interval: number;
    nextPollAt: number;
    status: 'pending' | 'authorized' | 'denied' | 'expired' | 'cancelled';
    accountId?: string;
    /** Encrypted DeviceAuthorizationState, bound to the flow record. */
    authorization?: string;
}

export interface CredentialStore {
    getProfile(id: string): Promise<StoredProfile | undefined>;
    listProfiles(): Promise<StoredProfile[]>;
    putProfile(profile: StoredProfile): Promise<void>;
    deleteProfile(id: string): Promise<void>;
    getAccount(profile: string, id: string): Promise<StoredAccount | undefined>;
    listAccounts(profile: string): Promise<StoredAccount[]>;
    putAccount(account: StoredAccount): Promise<void>;
    deleteAccount(profile: string, id: string): Promise<void>;
    getFlow(id: string): Promise<StoredFlow | undefined>;
    putFlow(flow: StoredFlow): Promise<void>;
}

export interface AppCredentials { brand: Brand; appId: string; appSecret: string }
export interface UpstreamToken {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    refresh_token_expires_in?: number;
    scope?: string;
    token_type?: 'Bearer' | 'DPoP';
    authorization?: TokenAuthorization;
}
export type DevicePoll = UpstreamToken | { error: string };

export interface UpstreamAuth {
    readonly options?: OAuthOptions;
    appUserScopes(app: AppCredentials): Promise<string[]>;
    beginDevice(app: AppCredentials, scopes: string[]): Promise<{
        device_code: string; verification_uri: string; verification_uri_complete?: string; expires_in: number; interval: number; authorization?: DeviceAuthorizationState;
    }>;
    pollDevice(app: AppCredentials, deviceCode: string, state?: DeviceAuthorizationState): Promise<DevicePoll>;
    userInfo(brand: Brand, token: string, authorization?: TokenAuthorization): Promise<{ open_id: string; name?: string }>;
    refresh(app: AppCredentials, refreshToken: string, authorization?: TokenAuthorization): Promise<UpstreamToken>;
    tenantToken(app: AppCredentials): Promise<{ tenant_access_token: string; expire: number }>;
    revoke(app: AppCredentials, token: string, authorization?: TokenAuthorization): Promise<void>;
}

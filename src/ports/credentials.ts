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

export interface StoredAccount {
    id: string;
    profileId: string;
    name: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    refreshExpiresAt: number;
    scopes: string[];
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
}
export type DevicePoll = UpstreamToken | { error: string };

export interface UpstreamAuth {
    appUserScopes(app: AppCredentials): Promise<string[]>;
    beginDevice(app: AppCredentials, scopes: string[]): Promise<{
        device_code: string; verification_uri: string; verification_uri_complete?: string; expires_in: number; interval: number;
    }>;
    pollDevice(app: AppCredentials, deviceCode: string): Promise<DevicePoll>;
    userInfo(brand: Brand, token: string): Promise<{ open_id: string; name?: string }>;
    refresh(app: AppCredentials, refreshToken: string): Promise<UpstreamToken>;
    tenantToken(app: AppCredentials): Promise<{ tenant_access_token: string; expire: number }>;
    revoke(app: AppCredentials, token: string): Promise<void>;
}

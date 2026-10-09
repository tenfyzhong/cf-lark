export type Brand = 'feishu' | 'lark';
export type Identity = 'user' | 'bot';
export type Risk = 'read' | 'write';
export type JsonObject = Record<string, unknown>;

export interface Grant {
    id: string;
    expiresAt: number;
    revoked: boolean;
    profiles: readonly {
        profileId: string;
        accounts: readonly string[];
        identities: readonly Identity[];
    }[];
    domains: readonly string[];
    permissions: readonly Risk[];
}

export interface ExecutionSelection {
    profileId: string;
    accountId?: string;
    identity: Identity;
}

export interface CommandDefinition {
    id: string;
    domain: string;
    description: string;
    inputSchema: JsonObject;
    identities: readonly Identity[];
    scopes: readonly string[];
    risk: Risk;
    source: 'api' | 'shortcut' | 'service';
}

export interface Profile {
    id: string;
    name: string;
    brand: Brand;
    appId: string;
    generation: number;
    createdAt: number;
}

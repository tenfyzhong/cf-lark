import type { ExecutionSelection } from '../domain/models';

/** Safe local metadata only. Implementations must not decrypt or contact upstream. */
export interface AuthorizationSnapshot {
    profileExists: boolean;
    credentialStatus: 'missing' | 'present';
    expiresAt?: number;
    refreshExpiresAt?: number;
    scopes?: readonly string[];
    tokenType?: 'Bearer' | 'DPoP';
    bindingStatus?: 'bound' | 'unbound' | 'missing_key';
    appScopes?: readonly string[];
}

export interface AuthorizationInspector {
    inspectAuthorization(selection: ExecutionSelection): Promise<AuthorizationSnapshot>;
}

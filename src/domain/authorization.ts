import { ServiceError } from './errors';
import type { ExecutionSelection, Grant, Risk } from './models';

export function grantDenialDetails(subtype: 'grant_expired' | 'grant_revoked' | 'grant_identity_denied' | 'grant_domain_denied' | 'grant_read_denied' | 'grant_write_denied') {
    return { type: 'authorization', subtype, retryable: false,
        troubleshooter: { action: 'renew_mcp_consent', message: 'Use an authorized identity and renew MCP consent with the required domains and read/write permissions. Lark application scopes and user consent are separate.' } };
}

export function authorize(
    grant: Grant,
    request: ExecutionSelection & { domain: string; risk: Risk },
    now: number,
): void {
    if (grant.revoked || grant.expiresAt <= now) {
        throw new ServiceError('GRANT_EXPIRED', 'Authorization has expired or was revoked.', 401, grantDenialDetails(grant.revoked ? 'grant_revoked' : 'grant_expired'));
    }
    const profile = grant.profiles.find((entry) => entry.profileId === request.profileId);
    const denial = !profile || !profile.identities.includes(request.identity)
        || (request.identity === 'user' && (!request.accountId || !profile.accounts.includes(request.accountId))) ? 'grant_identity_denied'
        : !grant.domains.includes(request.domain) ? 'grant_domain_denied'
            : !grant.permissions.includes(request.risk) ? request.risk === 'write' ? 'grant_write_denied' : 'grant_read_denied' : undefined;
    if (denial) throw new ServiceError('FORBIDDEN', 'This identity or operation is outside the authorization grant.', 403, grantDenialDetails(denial));
}

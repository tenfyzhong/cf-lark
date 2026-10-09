import { ServiceError } from './errors';
import type { ExecutionSelection, Grant, Risk } from './models';

export function authorize(
    grant: Grant,
    request: ExecutionSelection & { domain: string; risk: Risk },
    now: number,
): void {
    if (grant.revoked || grant.expiresAt <= now) {
        throw new ServiceError('GRANT_EXPIRED', 'Authorization has expired or was revoked.', 401);
    }
    const profile = grant.profiles.find((entry) => entry.profileId === request.profileId);
    if (!profile || !profile.identities.includes(request.identity)
        || !grant.domains.includes(request.domain) || !grant.permissions.includes(request.risk)
        || (request.identity === 'user' && (!request.accountId || !profile.accounts.includes(request.accountId)))) {
        throw new ServiceError('FORBIDDEN', 'This identity or operation is outside the authorization grant.', 403);
    }
}

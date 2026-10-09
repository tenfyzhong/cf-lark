import { ServiceError } from './errors';
import type { ExecutionSelection, Grant, Identity } from './models';

export interface SelectionInput {
    profileId?: string;
    accountId?: string;
    identity: Identity;
}

export function executionContext(grant: Grant, supported: readonly Identity[] = ['user', 'bot']) {
    return {
        profiles: grant.profiles.map((profile) => {
            const identities = profile.identities.filter((identity) => supported.includes(identity));
            return { profileId: profile.profileId, identities, accountIds: identities.includes('user') ? [...profile.accounts] : [] };
        }).filter((profile) => profile.identities.length > 0),
    };
}

export function resolveSelection(input: SelectionInput, grant: Grant, supported: readonly Identity[], now: number): ExecutionSelection {
    if (grant.revoked || grant.expiresAt <= now) throw new ServiceError('GRANT_EXPIRED', 'Authorization has expired or was revoked.', 401);
    if (!supported.includes(input.identity)) throw new ServiceError('UNSUPPORTED_IDENTITY', 'The command does not support this identity.');
    const context = executionContext(grant, [input.identity]);
    const candidates = context.profiles.filter((profile) => input.profileId === undefined || profile.profileId === input.profileId);
    if (!candidates.length) throw new ServiceError('FORBIDDEN', 'This identity is outside the authorization grant.', 403);
    if (candidates.length !== 1) {
        throw new ServiceError('SELECTION_REQUIRED', 'Choose a profileId from the authorized execution context.', 400, context);
    }
    const profile = candidates[0]!;
    let accountId = input.accountId;
    if (input.identity === 'user' && accountId === undefined) {
        if (profile.accountIds.length !== 1) {
            throw new ServiceError('SELECTION_REQUIRED', 'Choose an accountId from the authorized execution context.', 400, { profiles: [profile] });
        }
        accountId = profile.accountIds[0];
    }
    return { profileId: profile.profileId, identity: input.identity, ...(accountId === undefined ? {} : { accountId }) };
}

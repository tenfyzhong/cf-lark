import { ServiceError } from '../domain/errors';
import { resolveSelection, type SelectionInput } from '../domain/execution-selection';
import type { Grant } from '../domain/models';
import type { AuthorizationInspector } from '../ports/auth-diagnostics';
import type { CapabilityRegistry } from '../ports/capabilities';

export interface AuthDiagnosticInput extends SelectionInput { command?: string }

function expiry(value: number | undefined, now: number): 'unknown' | 'expired' | 'expiring' | 'active' {
    if (value === undefined || !Number.isSafeInteger(value) || value < 0) return 'unknown';
    return value <= now ? 'expired' : value <= now + 60_000 ? 'expiring' : 'active';
}

function scopeCheck(required: readonly string[] | undefined, granted: readonly string[] | undefined) {
    if (!required?.length || !Array.isArray(granted)) return { status: 'unknown' as const };
    const missing = required.filter(scope => !granted.includes(scope));
    return { status: missing.length ? 'missing_catalog_scopes' as const : 'catalog_scopes_present' as const, missing };
}

export class AuthDiagnosticService {
    constructor(private readonly registry: CapabilityRegistry, private readonly inspector?: AuthorizationInspector,
        private readonly now: () => number = Date.now) {}

    async diagnose(input: AuthDiagnosticInput, grant: Grant) {
        const now = this.now();
        const selection = resolveSelection(input, grant, ['user', 'bot'], now);
        const profile = grant.profiles.find(entry => entry.profileId === selection.profileId)!;
        // resolveSelection resolves ambiguity; this boundary also validates explicit account IDs.
        if ((selection.accountId !== undefined && !profile.accounts.includes(selection.accountId))
            || (selection.identity === 'user' && !selection.accountId)) {
            throw new ServiceError('FORBIDDEN', 'This account is outside the authorization grant.', 403,
                { type: 'authorization', subtype: 'grant_identity_denied', retryable: false });
        }
        if (!grant.permissions.includes('read')) throw new ServiceError('FORBIDDEN', 'Authorization diagnostics require read access.', 403,
            { type: 'authorization', subtype: 'grant_read_denied', retryable: false });
        const command = input.command === undefined ? undefined : this.registry.get(input.command);
        if (input.command !== undefined && !command) throw new ServiceError('UNKNOWN_COMMAND', 'The command is not implemented.', 404);
        const snapshot = await this.inspector?.inspectAuthorization(selection);
        const definition = command?.definition;
        const requiredPermission = command?.risk ? 'argument_dependent' : definition?.risk;
        const userScopes = selection.identity === 'bot' ? { status: 'not_applicable' as const } : scopeCheck(definition?.scopes, snapshot?.scopes);
        const appScopes = scopeCheck(definition?.scopes, snapshot?.appScopes);
        return {
            selection,
            ...(definition ? { command: { id: definition.id, domain: definition.domain, catalogScopes: [...definition.scopes] } } : {}),
            grant: { status: 'valid' as const, expiresAt: grant.expiresAt,
                identity: definition ? (definition.identities.includes(selection.identity) ? 'allowed' : 'denied') : 'not_checked',
                domain: definition ? (grant.domains.includes(definition.domain) ? 'allowed' : 'denied') : 'not_checked',
                permission: !definition ? 'not_checked' : command?.risk ? 'unknown' : grant.permissions.includes(definition.risk) ? 'allowed' : 'denied',
                ...(requiredPermission ? { requiredPermission } : {}),
                guidance: 'Denied domains or write access require renewed MCP consent. Lark app scopes and user consent are separate.' },
            credentials: {
                profile: snapshot === undefined ? 'unknown' : snapshot.profileExists ? 'present' : 'missing',
                status: snapshot?.credentialStatus === 'present' ? 'present' : snapshot?.credentialStatus === 'missing' ? 'missing' : 'unknown',
                token: expiry(snapshot?.expiresAt, now), refresh: selection.identity === 'bot' ? 'not_applicable' : expiry(snapshot?.refreshExpiresAt, now),
                ...(snapshot?.tokenType === 'Bearer' || snapshot?.tokenType === 'DPoP' ? { tokenType: snapshot.tokenType } : {}),
                ...(['bound', 'unbound', 'missing_key'].includes(snapshot?.bindingStatus ?? '') ? { bindingStatus: snapshot!.bindingStatus } : {}),
            },
            userScopes, appScopes,
            verification: 'local_metadata_only' as const, upstreamAccess: 'unknown' as const,
            guidance: 'Catalog scopes are advisory and may include alternatives. Local metadata cannot verify application installation, scope publication, resource permissions, or token validity. Stored binding metadata does not verify key health. No token was decrypted or refreshed and no upstream request was made.',
        };
    }
}

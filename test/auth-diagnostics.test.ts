import { describe, expect, it, vi } from 'vitest';
import { AuthDiagnosticService } from '../src/application/auth-diagnostics';
import { Registry } from '../src/capabilities/registry';
import type { Grant } from '../src/domain/models';
import type { AuthorizationSnapshot } from '../src/ports/auth-diagnostics';

const grant: Grant = { id: 'g', expiresAt: 2000, revoked: false,
    profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user', 'bot'] }], domains: ['docs'], permissions: ['read'] };
const definition = { id: 'docs.read', domain: 'docs', description: 'Read', inputSchema: {},
    identities: ['user', 'bot'] as const, scopes: ['docs:read'], risk: 'read' as const, source: 'api' as const };
function setup(snapshot: AuthorizationSnapshot = { profileExists: true, credentialStatus: 'present', expiresAt: 100000, refreshExpiresAt: 200000, scopes: ['docs:read'], tokenType: 'Bearer', bindingStatus: 'unbound' }) {
    const execute = vi.fn(), preview = vi.fn(), inspectAuthorization = vi.fn(async () => snapshot);
    const registry = new Registry([
        { definition, execute, preview },
        { definition: { ...definition, id: 'docs.write', risk: 'write' }, execute, preview },
        { definition: { ...definition, id: 'mail.read', domain: 'mail' }, execute, preview },
        { definition: { ...definition, id: 'docs.dynamic', risk: 'write' }, risk: () => 'write' as const, execute, preview },
    ]);
    return { service: new AuthDiagnosticService(registry, { inspectAuthorization }, () => 1000), inspectAuthorization, execute, preview };
}

describe('grant-safe local authorization diagnosis', () => {
    it('separates grant, token metadata, user scopes, and unknown app scopes', async () => {
        const fixture = setup();
        const result = await fixture.service.diagnose({ identity: 'user', command: 'docs.read' }, grant);
        expect(result).toMatchObject({ selection: { profileId: 'p', accountId: 'a', identity: 'user' },
            grant: { status: 'valid', domain: 'allowed', permission: 'allowed', identity: 'allowed' },
            credentials: { status: 'present', token: 'active', refresh: 'active', tokenType: 'Bearer' },
            userScopes: { status: 'catalog_scopes_present', missing: [] }, appScopes: { status: 'unknown' },
            verification: 'local_metadata_only', upstreamAccess: 'unknown' });
        expect(fixture.inspectAuthorization).toHaveBeenCalledExactlyOnceWith({ profileId: 'p', accountId: 'a', identity: 'user' });
        expect(fixture.execute).not.toHaveBeenCalled(); expect(fixture.preview).not.toHaveBeenCalled();
    });

    it.each([
        [{ identity: 'user', profileId: 'foreign' }, grant, 'FORBIDDEN'],
        [{ identity: 'user', accountId: 'foreign' }, grant, 'FORBIDDEN'],
        [{ identity: 'bot', accountId: 'foreign' }, grant, 'FORBIDDEN'],
        [{ identity: 'user' }, { ...grant, revoked: true }, 'GRANT_EXPIRED'],
        [{ identity: 'user' }, { ...grant, expiresAt: 1000 }, 'GRANT_EXPIRED'],
        [{ identity: 'user' }, { ...grant, permissions: [] }, 'FORBIDDEN'],
        [{ identity: 'user' }, { ...grant, profiles: [{ profileId: 'p', accounts: ['a'], identities: ['bot'] }] }, 'FORBIDDEN'],
    ] as const)('rejects unauthorized selection or grant before metadata reads', async (input, selectedGrant, code) => {
        const fixture = setup();
        await expect(fixture.service.diagnose(input, selectedGrant)).rejects.toMatchObject({ code });
        expect(fixture.inspectAuthorization).not.toHaveBeenCalled();
    });

    it('diagnoses domain and write denials independently without executing or listing other accounts', async () => {
        const fixture = setup();
        expect(await fixture.service.diagnose({ identity: 'user', command: 'mail.read' }, grant)).toMatchObject({ grant: { domain: 'denied', permission: 'allowed' } });
        expect(await fixture.service.diagnose({ identity: 'user', command: 'docs.write' }, grant)).toMatchObject({ grant: { domain: 'allowed', permission: 'denied', requiredPermission: 'write' } });
        expect(await fixture.service.diagnose({ identity: 'user', command: 'docs.dynamic' }, grant)).toMatchObject({ grant: { permission: 'unknown', requiredPermission: 'argument_dependent' } });
        expect(fixture.execute).not.toHaveBeenCalled();
    });

    it('reports missing scopes and expiry separately without promoting them to application facts', async () => {
        const fixture = setup({ profileExists: true, credentialStatus: 'present', expiresAt: 500, refreshExpiresAt: 100000, scopes: [], tokenType: 'DPoP', bindingStatus: 'missing_key' });
        expect(await fixture.service.diagnose({ identity: 'user', command: 'docs.read' }, grant)).toMatchObject({
            credentials: { token: 'expired', refresh: 'active', bindingStatus: 'missing_key' },
            userScopes: { status: 'missing_catalog_scopes', missing: ['docs:read'] }, appScopes: { status: 'unknown' } });
    });

    it('keeps absent credentials and unsupported user scope checks distinct', async () => {
        const fixture = setup({ profileExists: false, credentialStatus: 'missing' });
        expect(await fixture.service.diagnose({ identity: 'bot' }, grant)).toMatchObject({
            credentials: { status: 'missing', profile: 'missing', token: 'unknown' },
            userScopes: { status: 'not_applicable' }, appScopes: { status: 'unknown' } });
    });

    it('uses only public metadata fields and never reflects unknown fields or scope-shaped secrets', async () => {
        const fixture = setup({ profileExists: true, credentialStatus: 'present', scopes: ['token-secret', 'https://evil.example/?token=secret'],
            accessToken: 'access-secret', refreshToken: 'refresh-secret', dpopKey: 'private-secret', name: 'private-name', accounts: ['other-account'],
        } as AuthorizationSnapshot);
        const result = await fixture.service.diagnose({ identity: 'user', command: 'docs.read' }, grant);
        expect(JSON.stringify(result)).not.toMatch(/secret|evil\.example|private-name|other-account/u);
        expect(result.userScopes).toMatchObject({ status: 'missing_catalog_scopes', missing: ['docs:read'] });
    });
});

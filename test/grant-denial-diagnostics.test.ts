import { expect, it } from 'vitest';
import { authorize } from '../src/domain/authorization';
import { resolveSelection } from '../src/domain/execution-selection';
import type { Grant } from '../src/domain/models';

const grant: Grant = { id: 'g', expiresAt: 2000, revoked: false, domains: ['docs'], permissions: ['read'],
    profiles: [{ profileId: 'p', identities: ['user'], accounts: ['a'] }] };
const request = { identity: 'user' as const, profileId: 'p', accountId: 'a', domain: 'docs', risk: 'read' as const };
it.each([
    [{ profileId: 'private-other-profile' }, 'grant_identity_denied'],
    [{ accountId: 'private-other-account' }, 'grant_identity_denied'],
    [{ domain: 'private-other-domain' }, 'grant_domain_denied'],
    [{ risk: 'write' as const }, 'grant_write_denied'],
])('preserves FORBIDDEN and adds safe grant-denial classification', (change, subtype) => {
    let caught: unknown;
    try { authorize(grant, { ...request, ...change }, 1000); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: 'FORBIDDEN', message: 'This identity or operation is outside the authorization grant.', status: 403,
        details: { type: 'authorization', subtype, retryable: false, troubleshooter: { action: 'renew_mcp_consent' } } });
    expect(JSON.stringify(caught)).not.toContain('private-other');
});
it.each([
    [{ ...grant, expiresAt: 1000 }, 'grant_expired'],
    [{ ...grant, revoked: true }, 'grant_revoked'],
])('preserves grant-expired errors with specific safe reasons', (denied, subtype) => {
    for (const run of [() => authorize(denied, request, 1000), () => resolveSelection(request, denied, ['user'], 1000)]) {
        let caught: unknown; try { run(); } catch (error) { caught = error; }
        expect(caught).toMatchObject({ code: 'GRANT_EXPIRED', details: { subtype, retryable: false } });
    }
});
it('classifies the early execution-selection identity denial before credential access', () => {
    let caught: unknown;
    try { resolveSelection({ ...request, profileId: 'private-other-profile' }, grant, ['user'], 1000); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: 'FORBIDDEN', details: { subtype: 'grant_identity_denied' } });
    expect(JSON.stringify(caught)).not.toContain('private-other-profile');
});

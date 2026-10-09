import { expect, it } from 'vitest';
import { effectiveGrant } from '../src/domain/token-scope';
import type { Grant } from '../src/domain/models';

it('intersects immutable consent with the current token scopes', () => {
    const grant: Grant = { id: 'g', expiresAt: 1000, revoked: false, profiles: [], domains: ['im'], permissions: ['read', 'write'] };
    expect(effectiveGrant(grant, ['mcp:read']).permissions).toEqual(['read']);
    expect(effectiveGrant(grant, []).permissions).toEqual([]);
    expect(effectiveGrant({ ...grant, permissions: ['read'] }, ['mcp:read', 'mcp:write']).permissions).toEqual(['read']);
    expect(grant.permissions).toEqual(['read', 'write']);
});

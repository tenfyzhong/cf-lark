import type { Grant } from './models';

export function effectiveGrant(grant: Grant, scopes: readonly string[]): Grant {
    return { ...grant, permissions: grant.permissions.filter((permission) => scopes.includes(`mcp:${permission}`)) };
}

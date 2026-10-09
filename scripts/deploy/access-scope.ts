import { isDeepStrictEqual } from 'node:util';

type Resource = Record<string, unknown>;

/** Null or absent application settings inherit the organization's WARP setting. */
export function warpAuthenticationDisabled(application: Resource, organization: Resource): boolean {
    const applicationSetting = application.allow_authenticate_via_warp;
    return applicationSetting === false || (applicationSetting == null && organization.allow_authenticate_via_warp === false);
}

/** Overrides may make a protected path public even when its URI matches. */
export function destinationOverridesAbsent(destinations: unknown): boolean {
    return Array.isArray(destinations) && destinations.every((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const overrides = (entry as Resource).overrides;
        return overrides === undefined || isDeepStrictEqual(overrides, []);
    });
}

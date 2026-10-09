import { isDeepStrictEqual } from 'node:util';
import { prepareDeployment } from './bootstrap.ts';
import type { CloudflareRequest } from './cloudflare.ts';

type Inspection = { ready: boolean; checks: Record<string, boolean>; error?: string };

/** Read-only bootstrap diagnostics. Return checks, never upstream data or identifiers. */
export async function inspectDeployment(env: Record<string, string | undefined>, templates: Record<string, unknown>[], request: CloudflareRequest = fetch): Promise<Inspection> {
    const checks: Record<string, boolean> = {};
    let writeRefused = false;
    const readOnly: CloudflareRequest = async (url, init) => {
        if (init.method !== 'GET') {
            writeRefused = true;
            throw new Error('Inspection refuses provisioning');
        }
        const response = await request(url, init);
        if (response.ok && /\/access\/apps\/[^/]+$/u.test(new URL(url).pathname)) {
            const { result: app } = await response.clone().json() as { result?: Record<string, unknown> };
            if (app) {
                const hostname = new URL(env.PUBLIC_URL!).hostname;
                const expected = ['/api/admin', '/consent'].map((path) => ({ type: 'public', uri: hostname + path }));
                const destinations = Array.isArray(app.destinations) ? app.destinations as Record<string, unknown>[] : [];
                const sort = (values: { uri?: unknown }[]) => values.sort((a, b) => String(a.uri).localeCompare(String(b.uri)));
                Object.assign(checks, {
                    applicationType: app.type === 'self_hosted',
                    primaryDomain: app.domain === hostname + '/api/admin',
                    destinations: isDeepStrictEqual(sort(destinations.map((entry) => ({ type: entry.type, uri: entry.uri }))), sort(expected)),
                    destinationTypesExplicit: destinations.every((entry) => entry.type === 'public'),
                    destinationOverridesAbsent: destinations.every((entry) => entry.overrides === undefined || isDeepStrictEqual(entry.overrides, [])),
                    sessionDuration: app.session_duration === '8h',
                    warpDisabled: app.allow_authenticate_via_warp === false,
                    warpSettingPresent: app.allow_authenticate_via_warp !== undefined && app.allow_authenticate_via_warp !== null,
                });
            }
        }
        return response;
    };
    try {
        await prepareDeployment(env, templates, readOnly);
        return { ready: true, checks };
    } catch (error) {
        return { ready: false, checks, error: writeRefused ? 'Existing installation required; inspection refuses provisioning'
            : error instanceof Error ? error.message : 'Deployment inspection failed' };
    }
}

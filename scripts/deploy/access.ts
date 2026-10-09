import { isDeepStrictEqual } from 'node:util';
import { CloudflareBootstrapClient } from './cloudflare.ts';

type AccessSettings = { account: string; worker: string; hostname: string; emailDomain: string };
type Resource = Record<string, unknown>;
function resource(value: unknown): Resource {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Cloudflare Access resource');
    return value as Resource;
}
function identifier(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value)) throw new Error('Invalid Cloudflare Access identifier');
    return value;
}

/** Reuse a dedicated safe application; never overwrite unrelated login policies. */
export async function provisionAccess(client: CloudflareBootstrapClient, settings: AccessSettings): Promise<{ team: string; audience: string }> {
    const base = `/accounts/${settings.account}`;
    let organization = await client.call(`${base}/access/organizations`, 'GET', undefined, true);
    if (!organization) organization = await client.call(`${base}/access/organizations`, 'POST', {
        name: `${settings.worker} management`, auth_domain: `cf-lark-${settings.account}.cloudflareaccess.com`,
    });
    const authDomain = resource(organization?.result).auth_domain;
    if (typeof authDomain !== 'string' || !/^[a-z0-9-]+\.cloudflareaccess\.com$/u.test(authDomain)) throw new Error('Invalid Cloudflare Access issuer');
    const team = `https://${authDomain}`;

    const name = `${settings.worker}-management`;
    const destinations = ['/api/admin', '/consent'].map((path) => ({ type: 'public', uri: settings.hostname + path }));
    const policy = { name: `${settings.worker}-administrators`, decision: 'allow',
        include: [{ email_domain: { domain: settings.emailDomain } }], require: [], exclude: [] };
    const apps = await client.list(`${base}/access/apps`);
    const ownsManagement = (value: Resource) => [value.domain, ...(Array.isArray(value.destinations) ? value.destinations.map((entry) => resource(entry).uri) : [])]
        .some((path) => typeof path === 'string' && (path === settings.hostname || path.startsWith(`${settings.hostname}/`)));
    const matches = apps.filter(ownsManagement);
    if (matches.length > 1) throw new Error('Ambiguous Cloudflare Access application');
    if (!matches.length && apps.some((app) => app.name === name)) throw new Error('Cloudflare Access application name belongs to another hostname');
    let app = matches[0];
    if (app) app = resource((await client.call(`${base}/access/apps/${identifier(app.id)}`))?.result);
    const validateScope = (value: Resource) => {
        const actual = Array.isArray(value.destinations) ? value.destinations.map((item) => {
            const entry = resource(item);
            return { type: entry.type, uri: entry.uri };
        }).sort((a, b) => String(a.uri).localeCompare(String(b.uri))) : [];
        const expected = [...destinations].sort((a, b) => a.uri.localeCompare(b.uri));
        if (value.type !== 'self_hosted' || value.domain !== destinations[0]!.uri
            || !isDeepStrictEqual(actual, expected) || value.session_duration !== '8h' || value.allow_authenticate_via_warp !== false) {
            throw new Error('Unsafe existing Cloudflare Access application; check management destinations and session settings');
        }
        if (typeof value.aud !== 'string' || !/^[a-f0-9]{64}$/u.test(value.aud)) throw new Error('Invalid discovered Access audience');
    };
    if (app) validateScope(app);
    const providers = (await client.list(`${base}/access/identity_providers`)).filter((provider) => provider.type === 'onetimepin');
    if (providers.length > 1) throw new Error('Ambiguous Cloudflare email PIN identity provider');
    const pin = providers[0] ?? resource((await client.call(`${base}/access/identity_providers`, 'POST', {
        name: `${settings.worker}-email-pin`, type: 'onetimepin', config: {},
    }))?.result);
    const pinId = identifier(pin.id);
    if (app && !isDeepStrictEqual(app.allowed_idps, [pinId])) throw new Error('Unsafe Cloudflare Access identity providers');
    if (!app) {
        const created = resource((await client.call(`${base}/access/apps`, 'POST', {
            name, type: 'self_hosted', domain: destinations[0]!.uri, destinations, allowed_idps: [pinId],
            session_duration: '8h', allow_authenticate_via_warp: false, auto_redirect_to_identity: true,
            http_only_cookie_attribute: true, policies: [policy],
        }))?.result);
        app = resource((await client.call(`${base}/access/apps/${identifier(created.id)}`))?.result);
        validateScope(app);
        if (!isDeepStrictEqual(app.allowed_idps, [pinId])) throw new Error('Unsafe Cloudflare Access identity providers');
    }
    const policyPath = `${base}/access/apps/${identifier(app.id)}/policies`;
    let policies = await client.list(policyPath);
    if (!policies.length) {
        await client.call(policyPath, 'POST', policy);
        policies = await client.list(policyPath);
    }
    const current = policies[0];
    if (policies.length !== 1 || !current || current.decision !== 'allow'
        || (current.session_duration !== undefined && current.session_duration !== '8h')
        || !isDeepStrictEqual(current.include, policy.include) || !isDeepStrictEqual(current.require ?? [], [])
        || !isDeepStrictEqual(current.exclude ?? [], [])) throw new Error('Unsafe Cloudflare Access policies; check the dedicated email-domain policy');
    return { team, audience: String(app.aud) };
}

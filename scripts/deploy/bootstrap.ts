import { renderDeployment, type Deployment } from './configuration.ts';
import { CloudflareBootstrapClient, type CloudflareRequest } from './cloudflare.ts';
import { provisionAccess } from './access.ts';

type Environment = Record<string, string | undefined>;

async function discoverAccount(client: CloudflareBootstrapClient, hostname: string): Promise<string> {
    const labels = hostname.split('.');
    if (labels.length > 10) throw new Error('Cloudflare zone discovery exceeds limit');
    for (let index = 0; index < labels.length - 1; index++) {
        const zones = (await client.list(`/zones?name=${encodeURIComponent(labels.slice(index).join('.'))}`))
            .filter((zone) => zone.status === 'active');
        if (!zones.length) continue;
        if (zones.length !== 1) throw new Error('Ambiguous Cloudflare zone; set CLOUDFLARE_ACCOUNT_ID');
        const account = (zones[0]!.account as { id?: string } | undefined)?.id;
        if (!account || !/^[a-f0-9]{32}$/u.test(account)) throw new Error('Invalid Cloudflare zone account');
        return account;
    }
    throw new Error('No active Cloudflare zone found; set CLOUDFLARE_ACCOUNT_ID');
}

export async function prepareDeployment(env: Environment, templates: Record<string, unknown>[], request: CloudflareRequest = fetch): Promise<Deployment> {
    const resolved = { ...env };
    for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD']) resolved[key] = env[key]?.trim() || undefined;
    // Validate every explicit input before making any API request or mutation.
    const checked = renderDeployment({ ...resolved, CLOUDFLARE_ACCOUNT_ID: resolved.CLOUDFLARE_ACCOUNT_ID || '0'.repeat(32),
        ACCESS_TEAM_DOMAIN: resolved.ACCESS_TEAM_DOMAIN || 'https://validation.cloudflareaccess.com', ACCESS_AUD: resolved.ACCESS_AUD || '0'.repeat(64) }, templates);
    const vars = checked.configs[0]!.vars as Record<string, string>;
    const client = new CloudflareBootstrapClient(env.CLOUDFLARE_API_TOKEN!.trim(), request);
    resolved.CLOUDFLARE_ACCOUNT_ID ||= await discoverAccount(client, new URL(vars.PUBLIC_URL!).hostname);
    if (!resolved.ACCESS_TEAM_DOMAIN || !resolved.ACCESS_AUD) {
        const access = await provisionAccess(client, { account: resolved.CLOUDFLARE_ACCOUNT_ID, worker: String(checked.configs[0]!.name),
            hostname: new URL(vars.PUBLIC_URL!).hostname, emailDomain: vars.ACCESS_EMAIL_DOMAIN!, team: resolved.ACCESS_TEAM_DOMAIN,
            audience: resolved.ACCESS_AUD });
        resolved.ACCESS_TEAM_DOMAIN = access.team;
        resolved.ACCESS_AUD = access.audience;
    }
    return renderDeployment(resolved, templates);
}

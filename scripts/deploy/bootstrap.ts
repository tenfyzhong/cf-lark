import { renderDeployment, type Deployment } from './configuration.ts';
import { CloudflareBootstrapClient, type CloudflareRequest } from './cloudflare.ts';
import { discoverResources } from './resources.ts';
import { provisionAccess } from './access.ts';

type Environment = Record<string, string | undefined>;

async function discoverAccount(client: CloudflareBootstrapClient, hostname: string): Promise<string> {
    const labels = hostname.split('.');
    if (labels.length > 10) throw new Error('Cloudflare zone discovery exceeds limit');
    for (let index = 0; index < labels.length - 1; index++) {
        const zones = (await client.list(`/zones?name=${encodeURIComponent(labels.slice(index).join('.'))}`))
            .filter((zone) => zone.status === 'active');
        if (!zones.length) continue;
        if (zones.length !== 1) throw new Error('Ambiguous Cloudflare zone; check domain ownership and token scope');
        const account = (zones[0]!.account as { id?: string } | undefined)?.id;
        if (!account || !/^[a-f0-9]{32}$/u.test(account)) throw new Error('Invalid Cloudflare zone account');
        return account;
    }
    throw new Error('No active Cloudflare zone found; check domain activation and token scope');
}

export async function prepareDeployment(env: Environment, templates: Record<string, unknown>[], request: CloudflareRequest = fetch): Promise<Deployment> {
    // Discovered identifiers never come from user Secrets, including stale overrides.
    const resolved: Environment = { PUBLIC_URL: env.PUBLIC_URL, ACCESS_EMAIL_DOMAIN: env.ACCESS_EMAIL_DOMAIN,
        CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, ENCRYPTION_KEY: env.ENCRYPTION_KEY, WORKER_NAME: env.WORKER_NAME?.trim() || undefined,
        LARK_OAUTH_PROTOCOL: env.LARK_OAUTH_PROTOCOL, LARK_DPOP_MODE: env.LARK_DPOP_MODE };
    const checked = renderDeployment({ ...resolved, CLOUDFLARE_ACCOUNT_ID: '0'.repeat(32),
        ACCESS_TEAM_DOMAIN: 'https://validation.cloudflareaccess.com', ACCESS_AUD: '0'.repeat(64) }, templates);
    const vars = checked.configs[0]!.vars as Record<string, string>;
    const client = new CloudflareBootstrapClient(env.CLOUDFLARE_API_TOKEN!.trim(), request);
    resolved.CLOUDFLARE_ACCOUNT_ID = await discoverAccount(client, new URL(vars.PUBLIC_URL!).hostname);
    const resources = await discoverResources(client, resolved.CLOUDFLARE_ACCOUNT_ID, vars.PUBLIC_URL!, resolved.WORKER_NAME);
    resolved.WORKER_NAME = resources.worker;
    resolved.R2_BUCKET_NAME = resources.bucket;
    const access = await provisionAccess(client, { account: resolved.CLOUDFLARE_ACCOUNT_ID, worker: resources.worker,
        hostname: new URL(vars.PUBLIC_URL!).hostname, emailDomain: vars.ACCESS_EMAIL_DOMAIN! });
    resolved.ACCESS_TEAM_DOMAIN = access.team;
    resolved.ACCESS_AUD = access.audience;
    return renderDeployment(resolved, templates);
}

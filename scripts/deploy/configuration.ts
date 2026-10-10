import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Configuration = Record<string, unknown>;
type Environment = Record<string, string | undefined>;
export interface Deployment { configs: Configuration[]; secrets: { ENCRYPTION_KEY: string } }
export const deploymentFiles = ['wrangler.production.jsonc', 'wrangler.engine-docs.production.jsonc',
    'wrangler.engine-mail.production.jsonc', 'deployment-secrets.production.json'];

export function renderDeployment(env: Environment, templates: Configuration[]): Deployment {
    const required = (name: string) => {
        const value = env[name]?.trim();
        if (!value) throw new Error(`Missing ${name}`);
        return value;
    };
    const valid = (name: string, value: string, test: boolean) => {
        if (!test) throw new Error(`Invalid ${name}`);
        return value;
    };
    const origin = (name: string) => {
        const value = required(name);
        let url: URL;
        try { url = new URL(value); } catch { throw new Error(`Invalid ${name}`); }
        valid(name, value, url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/'
            && !url.search && !url.hash && !url.port);
        return url;
    };
    const account = required('CLOUDFLARE_ACCOUNT_ID');
    valid('CLOUDFLARE_ACCOUNT_ID', account, /^[a-f0-9]{32}$/u.test(account));
    const publicUrl = origin('PUBLIC_URL');
    valid('PUBLIC_URL', publicUrl.origin, !/(^|\.)example\.(com|org|net)$/u.test(publicUrl.hostname));
    const team = origin('ACCESS_TEAM_DOMAIN');
    valid('ACCESS_TEAM_DOMAIN', team.origin, /^[a-z0-9-]+\.cloudflareaccess\.com$/u.test(team.hostname));
    const audience = required('ACCESS_AUD');
    valid('ACCESS_AUD', audience, /^[a-f0-9]{64}$/u.test(audience));
    const domain = required('ACCESS_EMAIL_DOMAIN');
    valid('ACCESS_EMAIL_DOMAIN', domain, /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/u.test(domain));
    const worker = env.WORKER_NAME?.trim() || 'cf-lark';
    valid('WORKER_NAME', worker, /^[a-z0-9][a-z0-9-]{0,50}$/u.test(worker));
    const bucket = env.R2_BUCKET_NAME?.trim() || `${worker}-private`;
    valid('R2_BUCKET_NAME', bucket, /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(bucket));
    required('CLOUDFLARE_API_TOKEN');
    const key = required('ENCRYPTION_KEY');
    valid('ENCRYPTION_KEY', key, Buffer.from(key, 'base64').byteLength === 32 && Buffer.from(key, 'base64').toString('base64') === key);
    const protocol = env.LARK_OAUTH_PROTOCOL?.trim() || 'legacy';
    valid('LARK_OAUTH_PROTOCOL', protocol, protocol === 'legacy' || protocol === 'oauthv3');
    const dpopMode = env.LARK_DPOP_MODE?.trim() || 'disabled';
    valid('LARK_DPOP_MODE', dpopMode, ['disabled', 'preferred', 'required'].includes(dpopMode));
    if (protocol === 'legacy' && dpopMode !== 'disabled') throw new Error('LARK_DPOP_MODE requires LARK_OAUTH_PROTOCOL=oauthv3');
    if (templates.length !== 3) throw new Error('Three deployment templates are required.');
    const configs = templates.map((template, index) => ({ ...structuredClone(template),
        account_id: account, name: index === 0 ? worker : `${worker}-${index === 1 ? 'docs' : 'mail'}-engine` }));
    const main = configs[0]! as Configuration;
    main.routes = [{ pattern: publicUrl.hostname, custom_domain: true }];
    main.vars = { ...main.vars as Record<string, string>, PUBLIC_URL: publicUrl.origin, ACCESS_TEAM_DOMAIN: team.origin,
        ACCESS_AUD: audience, ACCESS_EMAIL_DOMAIN: domain, LARK_OAUTH_PROTOCOL: protocol, LARK_DPOP_MODE: dpopMode };
    main.services = [{ binding: 'DOCS_ENGINE', service: `${worker}-docs-engine` }, { binding: 'MAIL_ENGINE', service: `${worker}-mail-engine` }];
    main.r2_buckets = [{ binding: 'ARTIFACTS', bucket_name: bucket }];
    return { configs, secrets: { ENCRYPTION_KEY: key } };
}

export async function writeDeployment(directory: string, deployment: Deployment): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const file of deploymentFiles) {
        const exists = await access(join(directory, file)).then(() => true, (error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
            return false;
        });
        if (exists) throw new Error(`Deployment file already exists: ${file}`);
    }
    const values = [...deployment.configs, deployment.secrets];
    for (const [index, file] of deploymentFiles.entries()) {
        await writeFile(join(directory, file), JSON.stringify(values[index], null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    }
}

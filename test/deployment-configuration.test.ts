import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { deploymentFiles, renderDeployment, writeDeployment } from '../scripts/deploy/configuration';
import { parseLarkAuthOptions } from '../src/infrastructure/lark/auth-options';

const cloudflareFixture = new URL('./support/deployment-cloudflare.ts', import.meta.url).pathname;
const templates = await Promise.all(['wrangler.jsonc', 'wrangler.engine-docs.jsonc', 'wrangler.engine-mail.jsonc'].map(async (file) => JSON.parse(await readFile(file, 'utf8'))));
const environment = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), PUBLIC_URL: 'https://mcp.acme.test/',
    ACCESS_TEAM_DOMAIN: 'https://acme.cloudflareaccess.com', ACCESS_AUD: 'b'.repeat(64), ACCESS_EMAIL_DOMAIN: 'acme.test',
    CLOUDFLARE_API_TOKEN: 'test-only-api-token', ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') };

it.each([
    [{}, 'legacy', 'disabled'],
    [{ LARK_OAUTH_PROTOCOL: '', LARK_DPOP_MODE: '  ' }, 'legacy', 'disabled'],
    [{ LARK_OAUTH_PROTOCOL: 'legacy', LARK_DPOP_MODE: 'disabled' }, 'legacy', 'disabled'],
    [{ LARK_OAUTH_PROTOCOL: 'oauthv3' }, 'oauthv3', 'disabled'],
    [{ LARK_OAUTH_PROTOCOL: 'oauthv3', LARK_DPOP_MODE: 'disabled' }, 'oauthv3', 'disabled'],
    [{ LARK_OAUTH_PROTOCOL: ' oauthv3 ', LARK_DPOP_MODE: ' preferred ' }, 'oauthv3', 'preferred'],
    [{ LARK_OAUTH_PROTOCOL: 'oauthv3', LARK_DPOP_MODE: 'required' }, 'oauthv3', 'required'],
] as const)('renders public Worker OAuth settings from %j', (options, protocol, dpopMode) => {
    const source = structuredClone(templates);
    source[0].vars.LARK_OAUTH_PROTOCOL = 'oauthv3';
    source[0].vars.LARK_DPOP_MODE = 'required';
    const rendered = renderDeployment({ ...environment, ...options }, source);
    const vars = rendered.configs[0]!.vars as Record<string, string>;
    expect(vars).toMatchObject({ LARK_OAUTH_PROTOCOL: protocol, LARK_DPOP_MODE: dpopMode });
    expect(parseLarkAuthOptions(vars)).toEqual({ protocol, dpopMode });
    for (const config of rendered.configs.slice(1)) expect(config).not.toHaveProperty('vars');
    expect(rendered.secrets).toEqual({ ENCRYPTION_KEY: environment.ENCRYPTION_KEY });
    expect(source[0].vars.LARK_DPOP_MODE).toBe('required');
});

it.each([
    [{ LARK_OAUTH_PROTOCOL: 'unknown-private-value' }, 'Invalid LARK_OAUTH_PROTOCOL'],
    [{ LARK_OAUTH_PROTOCOL: 'OAuthV3' }, 'Invalid LARK_OAUTH_PROTOCOL'],
    [{ LARK_DPOP_MODE: 'unknown-private-value' }, 'Invalid LARK_DPOP_MODE'],
    [{ LARK_OAUTH_PROTOCOL: 'oauthv3', LARK_DPOP_MODE: 'Required' }, 'Invalid LARK_DPOP_MODE'],
    [{ LARK_DPOP_MODE: 'preferred' }, 'LARK_DPOP_MODE requires LARK_OAUTH_PROTOCOL=oauthv3'],
    [{ LARK_OAUTH_PROTOCOL: 'legacy', LARK_DPOP_MODE: 'required' }, 'LARK_DPOP_MODE requires LARK_OAUTH_PROTOCOL=oauthv3'],
] as const)('rejects invalid deployment OAuth settings %j without echoing values', (options, message) => {
    expect(() => renderDeployment({ ...environment, ...options }, templates)).toThrow(message);
    try { renderDeployment({ ...environment, ...options }, templates); }
    catch (error) { expect(String(error)).not.toContain('unknown-private-value'); }
});

it('renders an independent deployment while preserving storage, migrations and private engines', () => {
    const rendered = renderDeployment({ ...environment, WORKER_NAME: 'team-lark', R2_BUCKET_NAME: 'team-artifacts' }, templates);
    expect(rendered.configs[0]).toMatchObject({ name: 'team-lark', account_id: environment.CLOUDFLARE_ACCOUNT_ID,
        routes: [{ pattern: 'mcp.acme.test', custom_domain: true }],
        vars: { PUBLIC_URL: 'https://mcp.acme.test', ACCESS_EMAIL_DOMAIN: 'acme.test', MAX_STORAGE_BYTES: '2000000000' },
        services: [{ binding: 'DOCS_ENGINE', service: 'team-lark-docs-engine' }, { binding: 'MAIL_ENGINE', service: 'team-lark-mail-engine' }],
        r2_buckets: [{ binding: 'ARTIFACTS', bucket_name: 'team-artifacts' }] });
    for (let index = 0; index < 3; index++) expect(rendered.configs[index]?.migrations).toEqual(templates[index].migrations);
    expect(rendered.configs.slice(1).map((config) => config.name)).toEqual(['team-lark-docs-engine', 'team-lark-mail-engine']);
    for (const config of rendered.configs.slice(1)) {
        expect(config).toMatchObject({ workers_dev: false, preview_urls: false });
        expect(config).not.toHaveProperty('vars');
        expect(config).not.toHaveProperty('r2_buckets');
    }
    expect(JSON.stringify(rendered.configs)).not.toContain(environment.ENCRYPTION_KEY);
    expect(JSON.stringify(rendered)).not.toContain(environment.CLOUDFLARE_API_TOKEN);
    expect(rendered.secrets).toEqual({ ENCRYPTION_KEY: environment.ENCRYPTION_KEY });
    expect(templates[0].vars.PUBLIC_URL).toBe('https://mcp.example.com');
});

for (const key of Object.keys(environment)) it(`rejects missing ${key} before writing configuration`, () => {
    expect(() => renderDeployment({ ...environment, [key]: '' }, templates)).toThrow(key);
});
for (const [key, value] of [
    ['PUBLIC_URL', 'http://mcp.acme.test'], ['PUBLIC_URL', 'https://user:secret@mcp.acme.test'],
    ['PUBLIC_URL', 'https://mcp.acme.test/other?x=1'], ['PUBLIC_URL', 'https://mcp.example.com'],
    ['ACCESS_TEAM_DOMAIN', 'https://untrusted.test'], ['ACCESS_AUD', 'replace-with-access-audience'],
    ['ACCESS_EMAIL_DOMAIN', '@acme.test'], ['CLOUDFLARE_ACCOUNT_ID', 'invalid'],
    ['WORKER_NAME', 'unsafe/name'], ['R2_BUCKET_NAME', 'INVALID_BUCKET'], ['ENCRYPTION_KEY', Buffer.alloc(16).toString('base64')],
]) it(`rejects invalid ${key} without echoing secret values`, () => {
    expect(() => renderDeployment({ ...environment, [key]: value }, templates)).toThrow(`Invalid ${key}`);
});

it('writes private files and refuses to replace any existing configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cf-lark-deploy-'));
    try {
        const output = renderDeployment(environment, templates);
        await writeDeployment(directory, output);
        expect((await stat(join(directory, 'deployment-secrets.production.json'))).mode & 0o777).toBe(0o600);
        expect(JSON.parse(await readFile(join(directory, 'deployment-secrets.production.json'), 'utf8'))).toEqual(output.secrets);
        await expect(writeDeployment(directory, output)).rejects.toThrow('already exists');
        await rm(directory, { recursive: true });
        await writeFile(directory, 'existing file');
        await expect(writeDeployment(directory, output)).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
});

it('runs the deployment CLI without exposing credentials and preserves existing files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cf-lark-deploy-cli-'));
    const run = promisify(execFile);
    const entrypoint = new URL('../scripts/deploy/configure.ts', import.meta.url).pathname;
    const options = { cwd: directory, env: { ...process.env, ...environment, GITHUB_ACTIONS: 'false',
        LARK_OAUTH_PROTOCOL: 'oauthv3', LARK_DPOP_MODE: 'required' } };
    try {
        for (const [index, file] of ['wrangler.jsonc', 'wrangler.engine-docs.jsonc', 'wrangler.engine-mail.jsonc'].entries()) {
            await writeFile(join(directory, file), JSON.stringify(templates[index]));
        }
        const result = await run(process.execPath, ['--import', cloudflareFixture, entrypoint], options);
        expect(result.stdout.trim()).toBe('Private deployment configuration prepared.');
        expect(result.stderr).toBe('');
        expect(JSON.parse(await readFile(join(directory, 'wrangler.production.jsonc'), 'utf8'))).toMatchObject({
            name: 'cf-lark', vars: { LARK_OAUTH_PROTOCOL: 'oauthv3', LARK_DPOP_MODE: 'required' },
        });
        const before = await readFile(join(directory, 'deployment-secrets.production.json'), 'utf8');
        await expect(run(process.execPath, ['--import', cloudflareFixture, entrypoint], options)).rejects.toMatchObject({ code: 1 });
        expect(await readFile(join(directory, 'deployment-secrets.production.json'), 'utf8')).toBe(before);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

it('rejects invalid CLI OAuth settings without writing private deployment files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cf-lark-deploy-invalid-oauth-'));
    try {
        for (const [index, file] of ['wrangler.jsonc', 'wrangler.engine-docs.jsonc', 'wrangler.engine-mail.jsonc'].entries()) {
            await writeFile(join(directory, file), JSON.stringify(templates[index]));
        }
        await expect(promisify(execFile)(process.execPath, ['--import', cloudflareFixture,
            new URL('../scripts/deploy/configure.ts', import.meta.url).pathname], {
            cwd: directory, env: { ...process.env, ...environment, GITHUB_ACTIONS: 'false',
                LARK_OAUTH_PROTOCOL: 'legacy', LARK_DPOP_MODE: 'required' },
        })).rejects.toMatchObject({ code: 1, stdout: '', stderr: 'LARK_DPOP_MODE requires LARK_OAUTH_PROTOCOL=oauthv3\n' });
        for (const file of deploymentFiles) await expect(stat(join(directory, file))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(directory, { recursive: true, force: true }); }
});

it('masks resolved deployment identities before emitting Actions output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cf-lark-deploy-masks-'));
    try {
        for (const [index, file] of ['wrangler.jsonc', 'wrangler.engine-docs.jsonc', 'wrangler.engine-mail.jsonc'].entries()) {
            await writeFile(join(directory, file), JSON.stringify(templates[index]));
        }
        const result = await promisify(execFile)(process.execPath, ['--import', cloudflareFixture, new URL('../scripts/deploy/configure.ts', import.meta.url).pathname], {
            cwd: directory, env: { ...process.env, ...environment, GITHUB_ACTIONS: 'true' },
        });
        for (const value of [environment.CLOUDFLARE_ACCOUNT_ID, environment.ACCESS_AUD, 'mcp.acme.test', 'acme.cloudflareaccess.com', 'cf-lark-private']) {
            expect(result.stdout).toContain(`::add-mask::${value}\n`);
        }
        expect(result.stdout).not.toContain(environment.CLOUDFLARE_API_TOKEN);
        expect(result.stdout).not.toContain(environment.ENCRYPTION_KEY);
        expect(result.stderr).toBe('');
    } finally { await rm(directory, { recursive: true, force: true }); }
});

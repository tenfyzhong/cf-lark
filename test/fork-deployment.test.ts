import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

it('ships account-independent configuration and private deployment paths', async () => {
    const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
    expect(config).not.toHaveProperty('account_id');
    expect(config.vars.PUBLIC_URL).toBe('https://mcp.example.com');
    expect(config.vars.ACCESS_EMAIL_DOMAIN).toBe('example.com');
    expect(config.vars.ACCESS_TEAM_DOMAIN).toBe('https://your-team.cloudflareaccess.com');
    expect(config.vars.ACCESS_AUD).toBe('replace-with-access-audience');
    expect(config.vars.MAX_STORAGE_BYTES).toBe('2000000000');
    for (const domain of ['docs', 'mail']) {
        const engine = JSON.parse(await readFile(`wrangler.engine-${domain}.jsonc`, 'utf8'));
        expect(engine).not.toHaveProperty('account_id');
        expect(engine.workers_dev).toBe(false);
        expect(engine.preview_urls).toBe(false);
    }
    const scripts = JSON.parse(await readFile('package.json', 'utf8')).scripts;
    expect(scripts.deploy).toContain('--config wrangler.production.jsonc');
    expect(scripts['deploy:engines']).toContain('--config wrangler.engine-docs.production.jsonc');
    expect(scripts['deploy:engines']).toContain('--config wrangler.engine-mail.production.jsonc');
    const ignored = execFileSync('git', ['check-ignore', 'wrangler.production.jsonc', 'wrangler.engine-docs.production.jsonc', 'wrangler.engine-mail.production.jsonc'], { encoding: 'utf8' });
    expect(ignored.trim().split('\n')).toHaveLength(3);
});

it('keeps login presentation generic and authentication fixtures on example domains', async () => {
    const ui = await readFile('ui/main.tsx', 'utf8');
    expect(ui).toContain("Sign in with your organization's email.");
    expect(ui).not.toMatch(/Sign in with your @[^ ]+/u);
    for (const file of ['test/support/access-fixture.ts', 'test/support/browser-access.ts']) {
        const text = await readFile(file, 'utf8');
        const emails = [...text.matchAll(/email: '([^']+)'/gu)].map((match) => match[1]);
        expect(emails.length).toBeGreaterThan(0);
        for (const email of emails) expect(email).toMatch(/^[^@]+@example\.com$/u);
    }
});

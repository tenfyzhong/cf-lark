import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { execFileSync } from 'node:child_process';

it('includes declaration sources required by clean CI checkouts', () => {
    const declarations = ['src/infrastructure/documents/wasm.d.ts',
        'src/infrastructure/documents/generated/runtime.d.ts', 'test/runtime/env.d.ts', 'ui/env.d.ts'];
    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
    expect(declarations.filter((file) => !tracked.includes(file))).toEqual([]);
});

it('validates PRs without credentials and gates serialized production deployment to main', async () => {
    const workflow = parse(await readFile('.github/workflows/cloudflare.yml', 'utf8'));
    expect(workflow.on).toMatchObject({ push: { branches: ['main'] }, pull_request: { branches: ['main'] } });
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(JSON.stringify(workflow.jobs.verify)).not.toContain('secrets.');
    expect(workflow.jobs.verify.uses).toBe('./.github/workflows/tests.yml');
    expect(workflow.jobs.verify).not.toHaveProperty('secrets');
    expect(workflow.jobs.deploy.needs).toBe('verify');
    expect(workflow.jobs.deploy.if).toContain("github.ref == 'refs/heads/main'");
    expect(workflow.jobs.deploy.if).toContain("github.event_name != 'pull_request'");
    expect(JSON.stringify(workflow)).not.toContain('vars.');
    expect(workflow.jobs.deploy.env.DEPLOY_ENABLED).toBe("${{ secrets.DEPLOY_ENABLED || 'true' }}");
    for (const name of ['PUBLIC_URL', 'ACCESS_EMAIL_DOMAIN', 'WORKER_NAME']) {
        expect(workflow.jobs.deploy.env[name]).toBe('${{ secrets.' + name + ' }}');
    }
    for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'R2_BUCKET_NAME']) {
        expect(workflow.jobs.deploy.env).not.toHaveProperty(name);
        expect(JSON.stringify(workflow)).not.toContain('secrets.' + name);
    }
    expect(workflow.jobs.deploy.concurrency['cancel-in-progress']).toBe(false);
    const steps = workflow.jobs.deploy.steps;
    for (const step of steps.slice(0, -1)) expect(step.if).toBe("env.DEPLOY_ENABLED == 'true'");
    expect(steps.find((step: { run?: string }) => step.run === 'pnpm configure:deployment').env.ENCRYPTION_KEY).toBe('${{ secrets.ENCRYPTION_KEY }}');
    expect(steps.find((step: { run?: string }) => step.run === 'pnpm deploy:actions').env.CLOUDFLARE_API_TOKEN).toBe('${{ secrets.CLOUDFLARE_API_TOKEN }}');
    const provision = steps.findIndex((step: { run?: string }) => step.run === 'pnpm provision:r2');
    expect(provision).toBeGreaterThan(steps.findIndex((step: { run?: string }) => step.run === 'pnpm configure:deployment'));
    expect(provision).toBeLessThan(steps.findIndex((step: { run?: string }) => step.run === 'pnpm deploy:actions'));
    expect(steps[provision].env.CLOUDFLARE_API_TOKEN).toBe('${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(steps.findIndex((step: { run?: string }) => step.run === 'pnpm verify:deployment')).toBeGreaterThan(steps.findIndex((step: { run?: string }) => step.run === 'pnpm deploy:actions'));
    expect(steps.at(-1).if).toBe('always()');
    expect(steps.at(-1).run).toContain('deployment-secrets.production.json');
    for (const job of Object.values(workflow.jobs) as Array<{ steps?: Array<{ uses?: string }> }>) {
        for (const step of job.steps ?? []) if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/u);
    }
    const scripts = JSON.parse(await readFile('package.json', 'utf8')).scripts;
    expect(scripts['deploy:actions']).toContain('--secrets-file deployment-secrets.production.json');
});

it('runs separate credential-free unit and native integration jobs with complete release checks', async () => {
    const workflow = parse(await readFile('.github/workflows/tests.yml', 'utf8'));
    expect(workflow.on).toHaveProperty('workflow_call');
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(JSON.stringify(workflow)).not.toContain('secrets.');
    expect(JSON.stringify(workflow)).not.toContain('vars.');
    expect(workflow.env.WRANGLER_SEND_METRICS).toBe('false');
    expect(workflow.env.CI).toBe('true');
    const commands = (job: { steps: Array<{ run?: string }> }) => job.steps.filter((step) => step.run).map((step) => step.run);
    expect(commands(workflow.jobs.unit)).toEqual(['pnpm install --frozen-lockfile', 'pnpm test']);
    expect(commands(workflow.jobs.integration)).toEqual(['pnpm install --frozen-lockfile', 'pnpm test:runtime', 'pnpm test:engines']);
    expect(commands(workflow.jobs.release)).toEqual(['pnpm install --frozen-lockfile', 'pnpm check:validators', 'pnpm typecheck', 'pnpm test:architecture', 'pnpm build', 'pnpm exec playwright install --with-deps chromium', 'pnpm test:browser']);
    for (const job of Object.values(workflow.jobs) as Array<{ needs?: unknown; 'runs-on': string; 'timeout-minutes': number; steps: Array<{ uses?: string; with?: Record<string, unknown> }> }>) {
        expect(job.needs).toBeUndefined();
        expect(job['runs-on']).toBe('ubuntu-24.04');
        expect(job['timeout-minutes']).toBeGreaterThan(0);
        expect(job.steps.find((step) => step.uses?.startsWith('actions/checkout@'))?.with?.['persist-credentials']).toBe(false);
        expect(job.steps.find((step) => step.uses?.startsWith('actions/setup-node@'))?.with).toMatchObject({ 'node-version': '26', cache: 'pnpm' });
        for (const step of job.steps) if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/u);
    }
});

it('offers manual read-only inspection without production uploads or private files', async () => {
    const workflow = parse(await readFile('.github/workflows/cloudflare.yml', 'utf8'));
    expect(workflow.on.workflow_dispatch.inputs.inspect).toMatchObject({ type: 'boolean', default: false });
    expect(workflow.jobs.inspect.if).toBe("github.event_name == 'workflow_dispatch' && inputs.inspect");
    expect(workflow.jobs.deploy.if).toContain('!inputs.inspect');
    const steps = workflow.jobs.inspect.steps;
    expect(steps.some((step: { run?: string }) => step.run === 'pnpm inspect:deployment')).toBe(true);
    expect(JSON.stringify(steps)).not.toContain('deploy:actions');
    expect(JSON.stringify(steps)).not.toContain('provision:r2');
    expect(JSON.stringify(steps)).not.toContain('configure:deployment');
});

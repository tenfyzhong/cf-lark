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
    expect(workflow.jobs.deploy.needs).toBe('verify');
    expect(workflow.jobs.deploy.if).toContain("github.ref == 'refs/heads/main'");
    expect(workflow.jobs.deploy.if).toContain("github.event_name != 'pull_request'");
    expect(workflow.jobs.deploy.if).toContain("vars.DEPLOY_ENABLED == 'true'");
    expect(workflow.jobs.deploy.concurrency['cancel-in-progress']).toBe(false);
    const steps = workflow.jobs.deploy.steps;
    expect(steps.find((step: { run?: string }) => step.run === 'pnpm configure:deployment').env.ENCRYPTION_KEY).toBe('${{ secrets.ENCRYPTION_KEY }}');
    expect(steps.find((step: { run?: string }) => step.run === 'pnpm deploy:actions').env.CLOUDFLARE_API_TOKEN).toBe('${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(steps.at(-1).if).toBe('always()');
    expect(steps.at(-1).run).toContain('deployment-secrets.production.json');
    for (const job of Object.values(workflow.jobs) as Array<{ steps: Array<{ uses?: string }> }>) {
        for (const step of job.steps) if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/u);
    }
    const scripts = JSON.parse(await readFile('package.json', 'utf8')).scripts;
    expect(scripts['deploy:actions']).toContain('--secrets-file deployment-secrets.production.json');
});

import { readFile } from 'node:fs/promises';
import { writeDeployment } from './configuration.ts';
import { prepareDeployment } from './bootstrap.ts';

try {
    const files = ['wrangler.jsonc', 'wrangler.engine-docs.jsonc', 'wrangler.engine-mail.jsonc'];
    const templates = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, 'utf8'))));
    const deployment = await prepareDeployment(process.env, templates);
    if (process.env.GITHUB_ACTIONS === 'true') {
        const main = deployment.configs[0]!;
        const vars = main.vars as Record<string, string>;
        const bucket = (main.r2_buckets as Array<{ bucket_name: string }>)[0]!.bucket_name;
        for (const value of [String(main.account_id), String(main.name), bucket, vars.PUBLIC_URL!, new URL(vars.PUBLIC_URL!).hostname,
            vars.ACCESS_TEAM_DOMAIN!, new URL(vars.ACCESS_TEAM_DOMAIN!).hostname, vars.ACCESS_AUD!, vars.ACCESS_EMAIL_DOMAIN!]) {
            console.log(`::add-mask::${value}`);
        }
    }
    await writeDeployment(process.cwd(), deployment);
    console.log('Private deployment configuration prepared.');
} catch (error) {
    console.error(error instanceof Error ? error.message : 'Deployment configuration failed.');
    process.exitCode = 1;
}

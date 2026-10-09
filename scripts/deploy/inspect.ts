import { readFile } from 'node:fs/promises';
import { inspectDeployment } from './inspection.ts';

try {
    const files = ['wrangler.jsonc', 'wrangler.engine-docs.jsonc', 'wrangler.engine-mail.jsonc'];
    const templates = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, 'utf8'))));
    const report = await inspectDeployment(process.env, templates);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready) process.exitCode = 1;
} catch {
    console.error('Deployment inspection failed.');
    process.exitCode = 1;
}

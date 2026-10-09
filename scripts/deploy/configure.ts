import { readFile } from 'node:fs/promises';
import { renderDeployment, writeDeployment } from './configuration.ts';

try {
    const files = ['wrangler.jsonc', 'wrangler.engine-docs.jsonc', 'wrangler.engine-mail.jsonc'];
    const templates = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, 'utf8'))));
    await writeDeployment(process.cwd(), renderDeployment(process.env, templates));
    console.log('Private deployment configuration prepared.');
} catch (error) {
    console.error(error instanceof Error ? error.message : 'Deployment configuration failed.');
    process.exitCode = 1;
}

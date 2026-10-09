import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { verifyDeployment } from './smoke.ts';

try {
    const config = JSON.parse(await readFile('wrangler.production.jsonc', 'utf8')) as { vars: { PUBLIC_URL: string } };
    for (let attempt = 1; ; attempt++) {
        try { await verifyDeployment(config.vars.PUBLIC_URL); break; }
        catch {
            if (attempt >= 12) throw new Error('Deployment smoke checks failed after bounded retries');
            console.log('Waiting for deployment propagation.');
            await setTimeout(5_000);
        }
    }
    console.log('Public discovery and authorization boundaries verified.');
} catch {
    console.error('Deployment smoke checks failed; inspect domain and Access configuration.');
    process.exitCode = 1;
}

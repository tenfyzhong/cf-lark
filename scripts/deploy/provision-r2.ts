import { readFile } from 'node:fs/promises';
import { provisionR2 } from './r2.ts';

try {
    const config = JSON.parse(await readFile('wrangler.production.jsonc', 'utf8'));
    await provisionR2({ accountId: config.account_id ?? '', bucketName: config.r2_buckets?.[0]?.bucket_name ?? '',
        token: process.env.CLOUDFLARE_API_TOKEN ?? '' });
    console.log('Private R2 bucket and retention ready.');
} catch {
    console.error('R2 provisioning failed. Check R2 activation, deployment configuration and token permissions.');
    process.exitCode = 1;
}

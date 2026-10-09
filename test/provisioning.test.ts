import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { initializeSecrets } from '../scripts/provision/secrets';

it('creates independent protected secrets once and refuses destructive reinitialization', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cf-lark-secrets-test-'));
    const path = join(directory, 'private', 'secrets.json');
    try {
        await initializeSecrets(path);
        const content = await readFile(path, 'utf8');
        const secrets = JSON.parse(content);
        expect(secrets).not.toHaveProperty('ADMIN_SECRET');
        expect(Buffer.from(secrets.ENCRYPTION_KEY, 'base64').byteLength).toBe(32);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        await expect(initializeSecrets(path)).rejects.toMatchObject({ code: 'EEXIST' });
        expect(await readFile(path, 'utf8')).toBe(content);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function initializeSecrets(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify({
        ENCRYPTION_KEY: btoa(String.fromCharCode(...randomBytes(32))),
    }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

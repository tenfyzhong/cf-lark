import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

it('keeps authored repository files English and free of trailing whitespace', async () => {
    const files = new TextDecoder().decode(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
    const violations: string[] = [];
    for (const file of files) {
        const bytes = await readFile(file);
        if (file.endsWith('.wasm') && [0, 97, 115, 109, 1, 0, 0, 0].every((value, index) => bytes[index] === value)) continue;
        if (file.endsWith('.png') && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) continue;
        const content = new TextDecoder().decode(bytes);
        if (/\p{Script=Han}/u.test(content)) violations.push(`${file}: contains Han characters`);
        if (/[\t ]+$/mu.test(content)) violations.push(`${file}: trailing whitespace`);
    }
    expect(violations).toEqual([]);
});

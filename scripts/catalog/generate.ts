import { existsSync } from 'node:fs';
import { applyShortcutStatus, mergeShortcutStatuses } from './shortcut-status.ts';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { compileService } from './compile.ts';

const pinnedCommit = '72579c80027c863ca51d5f9affda72a70ab0d8a6';
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/catalog/generate.ts /path/to/pinned/lark-cli');
const root = resolve(source);
const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (commit !== pinnedCommit) throw new Error('The source checkout does not match the pinned upstream commit.');
const shortcutCommands = JSON.parse(execFileSync('go', ['run', resolve('scripts/catalog/inventory.go')], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
if (new Set(shortcutCommands.map((item: { id: string }) => item.id)).size !== shortcutCommands.length) throw new Error('Duplicate upstream shortcut IDs.');
const catalogPath = join(root, 'internal/registry/catalog');
const manifest = JSON.parse(await readFile(join(catalogPath, 'manifest.json'), 'utf8'));
const descriptors = [];
for (const service of manifest.services) {
    const bytes = await readFile(join(catalogPath, service.file));
    if (createHash('sha256').update(bytes).digest('hex') !== service.sha256) throw new Error(`Modified upstream catalog: ${service.name}`);
    descriptors.push(...compileService(JSON.parse(new TextDecoder().decode(bytes))));
}
const text = JSON.stringify(descriptors, null, 2) + '\n';
if (/\p{Script=Han}/u.test(text)) throw new Error('Generated metadata contains untranslated text.');
await mkdir('src/capabilities/api/generated', { recursive: true });
await writeFile('src/capabilities/api/generated/catalog.json', text);
const shortcutFiles: { domain: string; file: string }[] = [];
for (const domain of await readdir(join(root, 'shortcuts'), { withFileTypes: true })) {
    if (!domain.isDirectory() || domain.name === 'common') continue;
    for (const file of await readdir(join(root, 'shortcuts', domain.name))) {
        if (!file.endsWith('.go') || file.endsWith('_test.go')) continue;
        const content = await readFile(join(root, 'shortcuts', domain.name, file), 'utf8');
        if (/common\.Shortcut\s*\{|command\.New\s*\[|Command:\s*"\+/u.test(content)) shortcutFiles.push({ domain: domain.name, file: `shortcuts/${domain.name}/${file}` });
    }
}
const statusFiles = (await readdir('scripts/catalog')).filter((name) => name.endsWith('-status.json') && name !== 'event-key-status.json').sort();
const statuses = mergeShortcutStatuses(await Promise.all(statusFiles.map(async (name) => JSON.parse(await readFile(join('scripts/catalog', name), 'utf8')))));
await mkdir('docs/generated', { recursive: true });
await writeFile('docs/generated/coverage.json', JSON.stringify({
    version: 'v1.0.97', commit, apiCommands: descriptors.map((item) => ({ id: item.definition.id, status: 'implemented', evidence: 'test/api-capability.test.ts' })),
    shortcutCommands: applyShortcutStatus(shortcutCommands, statuses, existsSync, path => existsSync(join(root, path))),
    shortcutSourceInventory: shortcutFiles,
    fullCompatibility: false,
}, null, 2) + '\n');
console.log(`Generated ${descriptors.length} API commands; inventoried ${shortcutCommands.length} registered shortcuts in ${shortcutFiles.length} source files.`);

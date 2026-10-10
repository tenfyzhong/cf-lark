import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileService } from './compile.ts';
import { digestContract } from './upstream-contract.ts';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/catalog/check-upstream.ts /path/to/pinned/lark-cli');
const root = resolve(source);
const pin = JSON.parse(readFileSync('test/fixtures/upstream/contracts.json', 'utf8'));
const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (commit !== pin.commit) throw new Error(`Expected upstream ${pin.commit}; received ${commit}. Review and repin deliberately.`);
// The generated registered inventory remains on its original baseline. Verify the
// reviewed delta does not add, remove, or rename shortcut identity declarations.
const delta = execFileSync('git', ['-C', root, 'diff', pin.inventoryBaseline, pin.commit, '--', 'shortcuts'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (delta.split('\n').some(line => /^[+-](?![+-])/u.test(line) && /\b(?:Service|Command):/u.test(line))) {
    throw new Error('Upstream shortcut identity declarations changed; regenerate and review the registered inventory.');
}
for (const [file, digest] of Object.entries(pin.sourceSha256)) {
    if (createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex') !== digest) throw new Error(`Upstream source drift: ${file}`);
}
const manifest = JSON.parse(readFileSync(resolve(root, 'internal/registry/catalog/manifest.json'), 'utf8'));
const descriptors = manifest.services.flatMap((service: { file: string; sha256: string }) => {
    const bytes = readFileSync(resolve(root, 'internal/registry/catalog', service.file));
    if (createHash('sha256').update(bytes).digest('hex') !== service.sha256) throw new Error(`Catalog integrity mismatch: ${service.file}`);
    return compileService(JSON.parse(new TextDecoder().decode(bytes)));
});
if (digestContract(descriptors) !== pin.apiDescriptorSha256) throw new Error('Compiled upstream schema differs from the fixture.');
const hosted = JSON.parse(readFileSync('src/capabilities/api/generated/catalog.json', 'utf8'));
if (digestContract(hosted) !== pin.apiDescriptorSha256) throw new Error('Hosted typed API schema drift requires review.');
console.log(`Verified ${descriptors.length} typed schemas and ${Object.keys(pin.sourceSha256).length} pinned sources at ${commit}. No live acceptance is implied.`);

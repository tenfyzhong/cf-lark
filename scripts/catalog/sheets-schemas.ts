import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
const source = resolve(process.argv[2] ?? '/tmp/cf-lark-upstream-1.0.97');
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim() !== '72579c80027c863ca51d5f9affda72a70ab0d8a6') throw new Error('Expected pinned lark-cli source.');
const all = JSON.parse(await readFile(`${source}/shortcuts/sheets/data/flag-schemas.json`, 'utf8')).flags;
function clean(value: any): any {
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['description', 'examples', 'title', '$comment'].includes(key)).map(([key, entry]) => [key, clean(entry)]));
}
const ajv = new Ajv({ strict: false, allErrors: true, code: { source: true, esm: true } });
const exports: Record<string, string> = {}, names: string[] = [];
for (const [command, flags] of Object.entries(all) as [string, any][]) {
    if (!flags.properties) continue;
    const name = `compiledProperty${names.length}`; names.push(command.slice(1));
    ajv.addSchema(clean(flags.properties), name); exports[name] = name;
}
const code = '// @ts-nocheck\n// Generated from MIT-licensed larksuite/cli Sheets flag schemas.\n// Run scripts/catalog/sheets-schemas.ts with the pinned source checkout.\n' + standaloneCode(ajv, exports) + '\nexport const propertyValidators = {\n' + names.map((name, i) => `${JSON.stringify(name)}: compiledProperty${i},`).join('\n') + '\n};\n';
await mkdir('src/capabilities/sheets/generated', { recursive: true });
await writeFile('src/capabilities/sheets/generated/properties.ts', code);
const extraAjv = new Ajv({ strict: false, allErrors: true, code: { source: true, esm: true } });
const extraExports: Record<string, string> = {}, extraNames: string[] = [];
for (const [command, flags] of Object.entries(all) as [string, any][]) for (const [flag, schema] of Object.entries(flags)) {
    if (['properties', 'operations', 'sheets', 'styles'].includes(flag)) continue;
    const name = `compiledFlag${extraNames.length}`; extraNames.push(`${command.slice(1)}:${flag}`);
    extraAjv.addSchema(clean(schema), name); extraExports[name] = name;
}
await writeFile('src/capabilities/sheets/generated/flags.ts', '// @ts-nocheck\n// Generated from pinned MIT-licensed larksuite/cli Sheets flag schemas.\n' + standaloneCode(extraAjv, extraExports) + '\nexport const flagValidators = {\n' + extraNames.map((name, i) => `${JSON.stringify(name)}: compiledFlag${i},`).join('\n') + '\n};\n');

import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const source = process.argv[2] ?? '/tmp/cf-lark-upstream-1.0.97';
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim() !== '72579c80027c863ca51d5f9affda72a70ab0d8a6') throw new Error('Expected pinned Sheets source.');
const definitions = JSON.parse(await readFile(`${source}/shortcuts/sheets/data/flag-defs.json`, 'utf8'));
const enums = Object.fromEntries(Object.entries(definitions).map(([name, spec]: [string, any]) => [name.slice(1), Object.fromEntries(spec.flags.filter((flag: any) => flag.type === 'string' && flag.enum?.length).map((flag: any) => [flag.name, flag.enum]))]));
await writeFile('src/capabilities/sheets/generated/enums.ts', '// Generated from pinned MIT-licensed larksuite/cli flag definitions.\nexport const flagEnums: Record<string, Record<string, string[]>> = ' + JSON.stringify(enums, null, 2) + ';\n');
const schemas = JSON.parse(await readFile(`${source}/shortcuts/sheets/data/flag-schemas.json`, 'utf8')).flags;
const paths: Record<string, Record<string, string[]>> = {};
for (const [command, flags] of Object.entries(schemas) as [string, any][]) {
    if (!flags.properties) continue;
    const out: Record<string, string[]> = {};
    const walk = (schema: any, path: string[]) => {
        if (!schema || typeof schema !== 'object') return;
        if (Array.isArray(schema.enum)) out[path.join('/')] = [...new Set([...(out[path.join('/')] ?? []), ...schema.enum.filter((v: unknown) => typeof v === 'string')])];
        for (const [key, child] of Object.entries(schema.properties ?? {})) walk(child, [...path, key]);
        if (schema.items) walk(schema.items, [...path, '*']);
        for (const key of ['oneOf', 'anyOf', 'allOf']) for (const branch of schema[key] ?? []) walk(branch, path);
    };
    walk(flags.properties, []); paths[command.slice(1)] = out;
}
await writeFile('src/capabilities/sheets/generated/property-enums.ts', '// Generated from pinned MIT-licensed larksuite/cli flag schemas.\nexport const propertyEnums: Record<string, Record<string, string[]>> = ' + JSON.stringify(paths, null, 2) + ';\n');
const ergonomics = await readFile(`${source}/shortcuts/sheets/flag_ergonomics.go`, 'utf8');
const section = (name: string) => ergonomics.slice(ergonomics.indexOf(`var ${name} =`)).split('\n}\n')[0]!;
const pairs = (text: string) => Object.fromEntries([...text.replace(/\/\/[^\n]*/g, '').matchAll(/"([^"\n]+)"\s*:\s*"([^"\n]+)"/g)].map(m => [m[1], m[2]]));
const commandAliases = Object.fromEntries([...section('commandFlagAliases').matchAll(/"\+([^"\n]+)"\s*:\s*\{([^}]+)\}/g)].map(m => [m[1], pairs(m[2]!)]));
const flags = Object.fromEntries(Object.entries(definitions).map(([name, spec]: [string, any]) => [name.slice(1), Object.fromEntries(spec.flags.filter((f: any) => f.kind !== 'system').map((f: any) => [f.name, f.type]))]));
await writeFile('src/capabilities/sheets/generated/flag-vocabulary.ts', '// Generated from pinned MIT-licensed larksuite/cli flag vocabulary.\nexport const commandAliases: Record<string, Record<string, string>> = ' + JSON.stringify(commandAliases, null, 2) + ';\nexport const domainAliases: Record<string, string> = ' + JSON.stringify(pairs(section('domainFlagAliases')), null, 2) + ';\nexport const flagTypes: Record<string, Record<string, string>> = ' + JSON.stringify(flags, null, 2) + ';\n');
const dispatchSource = await readFile(`${source}/shortcuts/sheets/batch_op_dispatch.go`, 'utf8');
const dispatch = dispatchSource.slice(dispatchSource.indexOf('var batchOpDispatch =')).split('\n}\n')[0]!;
const shortcuts = [...dispatch.matchAll(/^\t"\+([^"\n]+)"\s*:/gm)].map(match => match[1]);
await writeFile('src/capabilities/sheets/generated/batch-shortcuts.ts', '// Generated from pinned MIT-licensed larksuite/cli batch dispatch.\nexport const batchShortcuts: string[] = ' + JSON.stringify(shortcuts, null, 2) + ';\n');
const fileFlags = Object.fromEntries(Object.entries(definitions).map(([name, spec]: [string, any]) => [name.slice(1), spec.flags.filter((f: any) => f.input?.includes('file')).map((f: any) => f.name)]));
await writeFile('src/capabilities/sheets/generated/file-flags.ts', '// Generated from pinned MIT-licensed larksuite/cli file-capable flag definitions.\nexport const fileFlags: Record<string, string[]> = ' + JSON.stringify(fileFlags, null, 2) + ';\n');

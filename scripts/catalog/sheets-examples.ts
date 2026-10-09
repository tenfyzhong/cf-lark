import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const source = process.argv[2] ?? '/tmp/cf-lark-upstream-1.0.97';
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim() !== '72579c80027c863ca51d5f9affda72a70ab0d8a6') throw new Error('Expected pinned lark-cli source.');
const text = await readFile(`${source}/shortcuts/sheets/chart_examples.go`, 'utf8');
const examples: Record<string, any> = {};
for (const match of text.matchAll(/"([a-z]+)":\s*`([\s\S]*?)`/g)) {
    const value = JSON.parse(match[2]!); value.snapshot.title.text = `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)} chart title`; examples[match[1]!] = value;
}
for (const type of ['column', 'bar', 'line', 'area', 'radar']) examples[type] = { position: { row: 1, col: 'F' }, size: { width: type === 'bar' ? 720 : 640, height: type === 'bar' ? 420 : 400 }, snapshot: { title: { text: 'Chart title' }, plotArea: { plot: { type } }, data: { refs: [{ value: "'Sheet1'!A1:C10" }], dim1: { serie: { index: 1 } }, dim2: { series: [{ index: 2 }, { index: 3 }] } } } };
if (Object.keys(examples).length !== 11) throw new Error('Unexpected pinned chart example inventory.');
await writeFile('src/capabilities/sheets/generated/chart-examples.ts', '// Generated from pinned lark-cli chart examples (MIT); placeholder titles translated to English.\nexport const chartExamples = ' + JSON.stringify(examples, null, 2) + ';\n');

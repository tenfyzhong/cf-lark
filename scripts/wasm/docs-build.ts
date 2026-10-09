import { prepareMailSources } from './mail-build.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
    mkdtemp,
    mkdir,
    readFile,
    writeFile,
    cp,
    readdir,
    stat,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const run = promisify(execFile);
export async function buildDocsParserProbe(
    source: string,
    group: 'combined' | 'docs' | 'mail' = 'combined',
) {
    const root = resolve(source);
    const head = (
        await run('git', ['rev-parse', 'HEAD'], { cwd: root })
    ).stdout.trim();
    if (head !== '72579c80027c863ca51d5f9affda72a70ab0d8a6')
        throw Error('Pinned upstream checkout required.');
    const directory = await mkdtemp(join(tmpdir(), 'cf-lark-docs-parser-'));
    if (group !== 'mail') {
        const parser = join(directory, 'internal/docxparse');
        await cp(join(root, 'shortcuts/doc/internal/docxparse'), parser, {
            recursive: true,
        });
        const imMarkdown = await readFile(
            join(root, 'shortcuts/doc/docs_fetch_im_markdown.go'),
            'utf8',
        );
        await writeFile(
            join(directory, 'im_markdown.go'),
            imMarkdown.replace('package doc', 'package main'),
        );
        const card = join(directory, 'internal/card');
        await mkdir(card, { recursive: true });
        for (const file of ['card.go', 'card_userdsl.go'])
            await cp(
                join(root, 'shortcuts/im/convert_lib', file),
                join(card, file),
            );
        await writeFile(
            join(card, 'bridge.go'),
            `package convertlib
    type ConvertContext struct {RawContent string; Mentions []interface{}}
    func ConvertCard(raw string, mentions []interface{}) string {return convertCard(raw,mentions)}
    `,
        );
        const extractFunction = (source: string, name: string) => {
            const start = source.indexOf(`func ${name}(`);
            const end = source.indexOf('\n}', start) + 2;
            if (start < 0 || end < 2)
                throw Error('Pinned pure helper not found.');
            return source.slice(start, end);
        };
        await writeFile(
            join(card, 'helpers.go'),
            'package convertlib\nimport "strings"\n' +
                extractFunction(
                    await readFile(
                        join(root, 'shortcuts/im/convert_lib/helpers.go'),
                        'utf8',
                    ),
                    'escapeMDLinkText',
                ) +
                '\n' +
                extractFunction(
                    await readFile(
                        join(
                            root,
                            'shortcuts/im/convert_lib/content_convert.go',
                        ),
                        'utf8',
                    ),
                    'extractMentionOpenId',
                ) +
                '\n',
        );
        const exportDir = join(directory, 'internal/recordexport');
        await mkdir(exportDir, { recursive: true });
        for (const file of await readdir(
            join(root, 'shortcuts/base/recordexport'),
        ))
            if (file.endsWith('.go') && !file.endsWith('_test.go'))
                await cp(
                    join(root, 'shortcuts/base/recordexport', file),
                    join(exportDir, file),
                );
        await cp(
            new URL('./base-bridge.go', import.meta.url),
            join(directory, 'base_bridge.go'),
        );
        const markdown = await readFile(
            join(root, 'shortcuts/base/record_markdown.go'),
            'utf8',
        );
        await writeFile(
            join(directory, 'base_markdown.go'),
            'package main\nimport("encoding/json";"fmt";"strings")\nconst maxRecordMarkdownIgnoredFields=20\nvar baseValidationErrorf=fmt.Errorf\n' +
                markdown.slice(
                    markdown.indexOf('func renderRecordGetMarkdown'),
                ),
        );
    }
    if (group !== 'docs') await prepareMailSources(root, directory);
    const mod = await readFile(join(root, 'go.mod'), 'utf8');
    const version = /golang.org\/x\/text\s+(\S+)/u.exec(mod)![1];
    await writeFile(
        join(directory, 'go.mod'),
        `module github.com/larksuite/cli/shortcuts/doc\n\ngo 1.25.0\n\nrequire golang.org/x/text ${version}\nrequire github.com/itchyny/gojq v0.12.17\nrequire golang.org/x/net v0.43.0\n`,
    );
    await writeFile(
        join(directory, 'main.go'),
        group === 'mail'
            ? 'package main\nfunc main(){select{}}\n'
            : `package main
import("encoding/json";"syscall/js";"github.com/larksuite/cli/shortcuts/doc/internal/docxparse";card "github.com/larksuite/cli/shortcuts/doc/internal/card")
func main(){js.Global().Set("cfLarkDocIMMarkdown",js.FuncOf(func(this js.Value,args []js.Value) interface{} {return convertToIMMarkdown(args[0].String(),newIMMarkdownContext(args[1].String()))}));js.Global().Set("cfLarkFormatEventCard",js.FuncOf(func(this js.Value,args []js.Value) interface{} {var mentions []interface{};if len(args)>1{json.Unmarshal([]byte(args[1].String()),&mentions)};return card.ConvertInteractiveEventContent(args[0].String(),mentions)}));js.Global().Set("cfLarkFormatCard",js.FuncOf(func(this js.Value,args []js.Value) interface{} {var mentions []interface{};if len(args)>1 {json.Unmarshal([]byte(args[1].String()),&mentions)};return card.ConvertCard(args[0].String(),mentions)}));js.Global().Set("cfLarkParseDocXML",js.FuncOf(func(this js.Value,args []js.Value) interface{} {if len(args)!=1{return "{\\"error\\":\\"Expected XML text.\\"}"};profile,err:=docxparse.ParseCompatibleXML(args[0].String());if err!=nil {value,_:=json.Marshal(map[string]string{"error":err.Error()});return string(value)};value,_:=json.Marshal(profile);return string(value)}));select{}}
`,
    );
    await run('go', ['mod', 'tidy'], { cwd: directory, timeout: 60000 });
    const wasm = join(directory, 'parser.wasm');
    await run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', wasm, '.'], {
        cwd: directory,
        env: { ...process.env, GOOS: 'js', GOARCH: 'wasm' },
        timeout: 120000,
    });
    const goroot = (await run('go', ['env', 'GOROOT'])).stdout.trim();
    await cp(
        join(goroot, 'lib/wasm/wasm_exec.js'),
        join(directory, 'wasm_exec.js'),
    );
    const runner = join(directory, 'probe.mjs');
    await writeFile(
        runner,
        `import {readFileSync} from 'node:fs';import './wasm_exec.js';const go=new globalThis.Go();const start=performance.now();const instance=await WebAssembly.instantiate(readFileSync(new URL('./parser.wasm',import.meta.url)),go.importObject);go.run(instance.instance);const parseStart=performance.now();const sample=JSON.parse(${group === 'mail' ? `globalThis.cfLarkMail('{"operation":"lint","body":"Hello"}')` : `globalThis.cfLarkParseDocXML('<p>Hello world</p>')`});console.log(JSON.stringify({sample,startupMs:parseStart-start,parseMs:performance.now()-parseStart,memoryBytes:instance.instance.exports.mem.buffer.byteLength}));process.exit(0);`,
    );
    const output = JSON.parse(
        (
            await run(process.execPath, [runner], {
                cwd: directory,
                timeout: 30000,
            })
        ).stdout,
    );
    return { directory, wasm, bytes: (await stat(wasm)).size, ...output };
}

export async function prepareDocsWorkerProbe(directory: string) {
    await writeFile(
        join(directory, 'worker.mjs'),
        `import './wasm_exec.js';import parser from './parser.wasm';let instance;let go;export default {async fetch(request){const input=await request.text();const start=performance.now();if(!instance){go=new globalThis.Go();instance=await WebAssembly.instantiate(parser,go.importObject);go.run(instance);}const started=performance.now();const result=JSON.parse(globalThis.cfLarkParseDocXML(input||'<p>Hello world</p>'));return Response.json({result,startupMs:started-start,parseMs:performance.now()-started,memoryBytes:instance.exports.mem.buffer.byteLength});}};`,
    );
    await writeFile(
        join(directory, 'wrangler.json'),
        JSON.stringify({
            name: 'cf-lark-docs-parser-probe',
            main: 'worker.mjs',
            compatibility_date: '2026-10-09',
            compatibility_flags: ['nodejs_compat'],
        }),
    );
    return join(directory, 'wrangler.json');
}

export async function installDocsParserAssets(
    source: string,
    target: string,
    group: 'combined' | 'docs' | 'mail' = 'combined',
) {
    const built = await buildDocsParserProbe(source, group);
    const { mkdir } = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    await mkdir(target, { recursive: true });
    await cp(built.wasm, join(target, 'parser.wasm'));
    const runtime = await readFile(
        join(built.directory, 'wasm_exec.js'),
        'utf8',
    );
    await writeFile(
        join(target, 'runtime.js'),
        runtime + '\nexport const Go = globalThis.Go;\n',
    );
    const goroot = (await run('go', ['env', 'GOROOT'])).stdout.trim();
    await cp(
        await readFile(join(goroot, 'LICENSE'))
            .then(() => join(goroot, 'LICENSE'))
            .catch(() => join(goroot, '..', 'LICENSE')),
        join(target, 'LICENSE.go.txt'),
    );
    await cp(join(source, 'LICENSE'), join(target, 'LICENSE.lark-cli.txt'));
    const dependencies = (
        await run(
            'go',
            ['list', '-m', '-f', '{{.Path}}|{{.Version}}|{{.Dir}}', 'all'],
            { cwd: built.directory },
        )
    ).stdout
        .trim()
        .split('\n')
        .map((line) => {
            const [path, version, directory] = line.split('|');
            return { path, version, directory };
        })
        .filter((item) => item.version);
    for (const dependency of dependencies) {
        for (const name of ['LICENSE', 'LICENSE.txt', 'COPYING']) {
            try {
                await cp(
                    join(dependency.directory!, name),
                    join(
                        target,
                        `LICENSE.${dependency.path!.replaceAll('/', '-')}.txt`,
                    ),
                );
                break;
            } catch {}
        }
    }
    const wasm = await readFile(built.wasm);
    const provenance = {
        group,
        dependencies: dependencies.map(({ directory: _, ...item }) => item),
        upstreamCommit: '72579c80027c863ca51d5f9affda72a70ab0d8a6',
        goVersion: (await run('go', ['version'])).stdout.trim(),
        sha256: createHash('sha256').update(wasm).digest('hex'),
        bytes: wasm.length,
    };
    await writeFile(
        join(target, 'provenance.json'),
        JSON.stringify(provenance, null, 2) + '\n',
    );
    return provenance;
}

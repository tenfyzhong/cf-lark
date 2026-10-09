import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, cp, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const pinned = '72579c80027c863ca51d5f9affda72a70ab0d8a6';

export async function buildHeadlessProbe(source: string) {
    const root = await realpath(resolve(source));
    const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    if (head !== pinned) throw new Error('The Wasm probe requires the pinned upstream commit.');
    const directory = await mkdtemp(join(tmpdir(), 'cf-lark-wasm-'));
    const replacements: Record<string, string> = {};
    let sequence = 0;
    const overlay = async (original: string, content: string) => {
        const target = join(directory, `overlay-${sequence++}.go`);
        await writeFile(target, content);
        replacements[original] = target;
    };
    const modfile = join(directory, 'go.mod');
    await cp(join(root, 'go.mod'), modfile);
    await cp(join(root, 'go.sum'), join(directory, 'go.sum'));
    const moduleDirectory = async (name: string) => {
        const original = JSON.parse((await run('go', ['list', '-m', '-json', name], { cwd: root })).stdout).Dir as string;
        const local = join(directory, name.replaceAll('/', '-'));
        await cp(original, local, { recursive: true });
        await run('chmod', ['-R', 'u+w', local]);
        try { await readFile(join(local, 'go.mod')); }
        catch { await writeFile(join(local, 'go.mod'), `module ${name}\n\ngo 1.23.0\n`); }
        await run('go', ['mod', 'edit', '-modfile', modfile, '-replace', `${name}=${local}`], { cwd: root });
        return local;
    };
    try {
        const clipboard = await moduleDirectory('github.com/atotto/clipboard');
        await overlay(join(clipboard, 'clipboard_js.go'), `package clipboard
import "errors"
func readAll() (string, error) { return "", errors.New("clipboard is unavailable in the cloud runtime") }
func writeAll(string) error { return errors.New("clipboard is unavailable in the cloud runtime") }
`);
        const tea = await moduleDirectory('github.com/charmbracelet/bubbletea');
        await overlay(join(tea, 'tty_js.go'), `package tea
import ("errors"; "os")
const suspendSupported = false
func suspendProcess() {}
func (p *Program) initInput() error { return errors.New("interactive terminal input is unavailable in the cloud runtime") }
func openInputTTY() (*os.File, error) { return nil, errors.New("a terminal is unavailable in the cloud runtime") }
func (p *Program) listenForResize(done chan struct{}) { close(done) }
`);
        const flock = await moduleDirectory('github.com/gofrs/flock');
        await overlay(join(flock, 'flock_unix.go'), `package flock
import "errors"
func (f *Flock) Lock() error { return errors.New("filesystem locks require an isolated runtime adapter") }
func (f *Flock) RLock() error { return f.Lock() }
func (f *Flock) TryLock() (bool, error) { return false, f.Lock() }
func (f *Flock) TryRLock() (bool, error) { return false, f.Lock() }
func (f *Flock) Unlock() error { return nil }
`);
        const localFile = join(root, 'internal/vfs/localfileio/openvalidated_unix.go');
        const original = await readFile(localFile, 'utf8');
        const modified = original.replace('os.O_RDONLY | syscall.O_NOFOLLOW | syscall.O_NONBLOCK', 'os.O_RDONLY');
        if (modified === original) throw new Error('The pinned filesystem implementation changed.');
        await overlay(localFile, modified);
        await overlay(join(root, 'internal/keychain/keychain_js.go'), `package keychain
import "errors"
func platformGet(service, account string) (string, error) { return "", errors.New("native keychain is unavailable in the cloud runtime") }
func platformSet(service, account, data string) error { return errors.New("native keychain is unavailable in the cloud runtime") }
func platformRemove(service, account string) error { return errors.New("native keychain is unavailable in the cloud runtime") }
`);
        await overlay(join(root, 'internal/lockfile/lock_unix.go'), `package lockfile
import ("errors"; "os")
func tryLockFile(f *os.File) error { return errors.New("filesystem locks require an isolated runtime adapter") }
func unlockFile(f *os.File) error { return nil }
`);
        await overlay(join(root, 'internal/event/consume/startup_unix.go'), `package consume
import "os/exec"
func applyDetachAttrs(cmd *exec.Cmd) {}
`);
        await overlay(join(root, 'cmd/event/signals_js.go'), `package event
func ignoreBrokenPipe() {}
`);
        const overlayPath = join(directory, 'overlay.json');
        await writeFile(overlayPath, JSON.stringify({ Replace: replacements }));
        const path = join(directory, 'lark-cli.wasm');
        await run('go', ['build', '-modfile', modfile, '-tags', 'noauthsidecar', '-overlay', overlayPath, '-ldflags=-s -w', '-o', path, '.'], {
            cwd: root, env: { ...process.env, GOOS: 'js', GOARCH: 'wasm' }, maxBuffer: 2 * 1024 * 1024,
        });
        const optimized = join(directory, 'lark-cli.optimized.wasm');
        await run(process.execPath, [fileURLToPath(new URL('../../node_modules/binaryen/bin/wasm-opt', import.meta.url)),
            path, '-Oz', '--enable-bulk-memory', '--enable-sign-ext', '--enable-nontrapping-float-to-int', '-o', optimized],
        { timeout: 300_000, maxBuffer: 2 * 1024 * 1024 });
        return { directory, path: optimized };
    } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
    }
}

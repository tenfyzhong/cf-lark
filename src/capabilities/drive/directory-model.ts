import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ContentHasher } from '../../ports/content-hasher';
import { invalid, obj, resource, str } from './helpers';
export interface DirectoryEntry extends JsonObject { path: string; type: string; artifact_id?: string; token?: string; modified_time?: string; created_time?: string }
export function safeRelative(value: unknown): string {
    const path = str(value);
    if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || /[\\\x00-\x1f]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) invalid('Directory paths must be safe nonempty relative paths.');
    return path;
}
export function parseManifest(value: unknown): DirectoryEntry[] {
    const manifest = obj(value);
    if (manifest.version !== 1 || !Array.isArray(manifest.entries)) invalid('A version 1 directory manifest with an entries array is required.');
    const entries = new Map<string, DirectoryEntry>();
    for (const raw of manifest.entries) {
        const item = obj(raw), path = safeRelative(item.path), type = str(item.type);
        if (!['file', 'directory'].includes(type)) invalid('Manifest entries must be files or directories.');
        if (entries.has(path)) invalid('Manifest paths must be unique.');
        entries.set(path, { path, type, ...(type === 'file' ? { artifact_id: resource(item.artifact_id, 'artifact_id') } : {}), ...(item.modified_time !== undefined ? { modified_time: String(item.modified_time) } : {}) });
    }
    for (const item of [...entries.values()]) {
        const parts = item.path.split('/'); parts.pop();
        while (parts.length) { const path = parts.join('/'), parent = entries.get(path); if (parent && parent.type !== 'directory') invalid('A manifest file cannot contain child paths.'); if (!parent) entries.set(path, { path, type: 'directory' }); parts.pop(); }
    }
    return [...entries.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function epoch(value: unknown): { micros: bigint; resolution: bigint } | undefined {
    const text = str(value);
    if (/^-?\d+$/.test(text)) { const raw = BigInt(text), magnitude = raw < 0n ? -raw : raw; const multiplier = magnitude > 100000000000000n ? 1n : magnitude > 100000000000n ? 1000n : 1000000n; return { micros: raw * multiplier, resolution: multiplier }; }
    const parsed = Date.parse(text); return Number.isFinite(parsed) ? { micros: BigInt(parsed) * 1000n, resolution: 1000n } : undefined;
}
export function compareTimes(remote: unknown, local: unknown): number | undefined {
    const a = epoch(remote), b = epoch(local); if (!a || !b) return undefined;
    const left = a.micros, right = b.micros / a.resolution * a.resolution;
    return left < right ? -1 : left > right ? 1 : 0;
}
function sortDuplicates(entries: DirectoryEntry[], policy: string) {
    return [...entries].sort((a, b) => {
        const keys = policy === 'newest' ? ['modified_time', 'created_time'] : ['created_time', 'modified_time'];
        for (const key of keys) { const comparison = compareTimes(a[key], b[key]); if (comparison === undefined) break; if (comparison) return policy === 'newest' ? -comparison : comparison; }
        return str(a.token) < str(b.token) ? -1 : str(a.token) > str(b.token) ? 1 : 0;
    });
}
function suffixed(path: string, suffix: string) { const slash = path.lastIndexOf('/'), dot = path.lastIndexOf('.'); return dot > slash + 1 ? `${path.slice(0, dot)}${suffix}${path.slice(dot)}` : `${path}${suffix}`; }
export async function uniqueSibling(path: string, token: string, occupied: Set<string>, hasher: ContentHasher) {
    const hash = await hasher.sha256(new Blob([token]).stream());
    const suffixes = [hash.slice(0, 12), hash.slice(0, 24), hash, ...Array.from({ length: 1023 }, (_, index) => `${hash}_${index + 2}`)];
    for (const suffix of suffixes) { const name = suffixed(path, `__lark_${suffix}`); if (!occupied.has(name)) { occupied.add(name); return name; } }
    throw new ServiceError('DUPLICATE_REMOTE_PATH', 'Could not allocate a stable conflict filename.');
}
export async function resolveRemote(entries: DirectoryEntry[], policy: string, hasher: ContentHasher) {
    const groups = new Map<string, DirectoryEntry[]>(), occupied = new Set(entries.map((entry) => entry.path));
    for (const entry of entries) groups.set(entry.path, [...(groups.get(entry.path) || []), entry]);
    const output: DirectoryEntry[] = [];
    for (const [path, rows] of [...groups].sort(([a], [b]) => a < b ? -1 : 1)) {
        if (rows.length === 1) { output.push(rows[0]!); continue; }
        if (policy === 'fail' || rows.some((row) => row.type !== 'file')) throw new ServiceError('DUPLICATE_REMOTE_PATH', 'Multiple remote resources occupy the same relative path.', 409, { path, entries: rows.map((row) => ({ token: row.token, type: row.type })) });
        const sorted = sortDuplicates(rows, policy);
        if (policy !== 'rename') { output.push(sorted[0]!); continue; }
        for (let index = 0; index < sorted.length; index++) { const row = sorted[index]!; output.push({ ...row, path: index ? await uniqueSibling(path, str(row.token), occupied, hasher) : path }); }
    }
    return output;
}
export function validateDirectoryArgs(action: string, args: JsonObject) {
    resource(args['local-dir'], 'local-dir'); resource(args['folder-token'], 'folder-token');
    if ((args['delete-local'] || args['delete-remote']) && args.yes !== true) invalid('Deletion requires yes=true.');
    if (args['if-exists'] && !['skip', 'smart', 'overwrite'].includes(str(args['if-exists']))) invalid('Unsupported if-exists policy.');
    if (args['on-duplicate-remote'] && !['fail', 'newest', 'oldest', ...(action === 'pull' ? ['rename'] : [])].includes(str(args['on-duplicate-remote']))) invalid('Unsupported duplicate remote policy.');
    if (args['on-conflict'] && !['remote-wins', 'local-wins', 'keep-both', 'ask'].includes(str(args['on-conflict']))) invalid('Unsupported conflict policy.');
    for (const [path, decision] of Object.entries(obj(args['conflict-decisions']))) { safeRelative(path); if (!['remote-wins', 'local-wins', 'keep-both', 'skip'].includes(str(decision))) invalid('Unsupported conflict decision.'); }
}

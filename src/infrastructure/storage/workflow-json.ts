import { ServiceError } from '../../domain/errors';
export const MAX_WORKFLOW_BYTES = 32 * 1024 * 1024;
const encoder = new TextEncoder();
function invalid(message: string): never { throw new ServiceError('INVALID_WORKFLOW_STATE', message, 400); }
function* quoted(value: string): Generator<string> {
    yield '"';
    for (let start = 0; start < value.length;) {
        let end = Math.min(value.length, start + 8192);
        if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end--;
        yield JSON.stringify(value.slice(start, end)).slice(1, -1); start = end;
    }
    yield '"';
}
export function* jsonChunks(value: unknown, active = new Set<object>(), depth = 0, budget = { nodes: 0 }): Generator<string> {
    if (++budget.nodes > 100000) throw new ServiceError('WORKFLOW_TOO_COMPLEX', 'Workflow JSON must not exceed 100000 values.', 413);
    if (depth > 128) invalid('Workflow JSON nesting exceeds 128 levels.');
    if (value === null || value === undefined) { yield 'null'; return; }
    if (typeof value === 'string') { yield* quoted(value); return; }
    if (typeof value === 'number') { yield Number.isFinite(value) ? String(value) : 'null'; return; }
    if (typeof value === 'boolean') { yield String(value); return; }
    if (typeof value !== 'object') invalid('Workflow values must be JSON-serializable.');
    if (active.has(value)) invalid('Workflow JSON must not contain cycles.'); active.add(value);
    if (Array.isArray(value)) {
        yield '[';
        for (let i = 0; i < value.length; i++) { if (i) yield ','; yield* jsonChunks(value[i], active, depth + 1, budget); }
        yield ']';
    } else {
        if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) invalid('Workflow objects must be plain JSON objects.');
        yield '{'; let count = 0;
        for (const key of Object.keys(value)) {
            const child = (value as Record<string, unknown>)[key]; if (child === undefined) continue;
            if (count++) yield ','; yield* quoted(key); yield ':'; yield* jsonChunks(child, active, depth + 1, budget);
        }
        yield '}';
    }
    active.delete(value);
}
export function jsonSize(value: unknown, maximum = MAX_WORKFLOW_BYTES): number {
    let bytes = 0; for (const chunk of jsonChunks(value)) { bytes += encoder.encode(chunk).length; if (bytes > maximum) throw new ServiceError('WORKFLOW_TOO_LARGE', `Workflow state and output must not exceed ${maximum} serialized bytes.`, 413); } return bytes;
}
interface Frame { value: Record<string, unknown> | unknown[]; array: boolean; phase: 'key' | 'colon' | 'value' | 'comma'; key?: string; initial: boolean }
/** Incremental JSON decoder: retains decoded values, never a second complete JSON text. */
export class WorkflowJsonParser {
    private stack: Frame[] = [];
    private root: unknown;
    private hasRoot = false;
    private token: 'string' | 'literal' | null = null;
    private pieces: string[] = [];
    private escaped = false;
    private unicode: string | null = null;
    private bytes = 0;
    private nodes = 0;
    private bad(): never { throw new ServiceError('INVALID_WORKFLOW_BLOB', 'Workflow JSON is malformed.', 500); }
    private emit(value: unknown) {
        if (++this.nodes > 200000) throw new ServiceError('WORKFLOW_TOO_COMPLEX', 'Workflow JSON exceeds its structural bound.', 413);
        const frame = this.stack.at(-1);
        if (!frame) { if (this.hasRoot) this.bad(); this.root = value; this.hasRoot = true; return; }
        if (!frame.array && frame.phase === 'key') { if (typeof value !== 'string') this.bad(); frame.key = value; frame.phase = 'colon'; return; }
        if (frame.phase !== 'value') this.bad();
        if (frame.array) (frame.value as unknown[]).push(value);
        else Object.defineProperty(frame.value, frame.key!, { value, enumerable: true, configurable: true, writable: true });
        frame.phase = 'comma'; frame.initial = false;
    }
    private literal() {
        const value = this.pieces.join(''); this.pieces = []; this.token = null;
        if (!/^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(value)) this.bad();
        this.emit(JSON.parse(value));
    }
    push(chunk: string) {
        this.bytes += encoder.encode(chunk).length; if (this.bytes > MAX_WORKFLOW_BYTES) throw new ServiceError('WORKFLOW_TOO_LARGE', 'Workflow blob exceeds its serialized size limit.', 413);
        let index = 0;
        while (index < chunk.length) {
            const char = chunk[index]!;
            if (this.token === 'string') {
                if (this.unicode !== null) { if (!/[0-9a-f]/i.test(char)) this.bad(); this.unicode += char; index++; if (this.unicode.length === 4) { this.pieces.push(String.fromCharCode(Number.parseInt(this.unicode, 16))); this.unicode = null; } continue; }
                if (this.escaped) { this.escaped = false; index++; if (char === 'u') this.unicode = ''; else { const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }; if (!(char in escapes)) this.bad(); this.pieces.push(escapes[char]!); } continue; }
                if (char === '"') { this.token = null; index++; const value = this.pieces.join(''); this.pieces = []; this.emit(value); continue; }
                if (char === '\\') { this.escaped = true; index++; continue; }
                let end = index; while (end < chunk.length && chunk[end] !== '"' && chunk[end] !== '\\') { if (chunk.charCodeAt(end) < 32) this.bad(); end++; }
                this.pieces.push(chunk.slice(index, end)); index = end; continue;
            }
            if (this.token === 'literal') {
                if (/[\s,}\]]/.test(char)) { this.literal(); continue; }
                this.pieces.push(char); if (this.pieces.length > 1024) this.bad(); index++; continue;
            }
            if (/\s/.test(char)) { index++; continue; }
            const frame = this.stack.at(-1);
            if (char === '}' || char === ']') {
                if (!frame || (char === ']') !== frame.array || !(frame.phase === 'comma' || frame.initial && (frame.array ? frame.phase === 'value' : frame.phase === 'key'))) this.bad();
                this.stack.pop(); index++; this.emit(frame.value); continue;
            }
            if (char === ',') { if (!frame || frame.phase !== 'comma') this.bad(); frame.phase = frame.array ? 'value' : 'key'; frame.initial = false; index++; continue; }
            if (char === ':') { if (!frame || frame.array || frame.phase !== 'colon') this.bad(); frame.phase = 'value'; index++; continue; }
            if (frame && frame.phase !== 'value' && !(frame.phase === 'key' && char === '"') || !frame && this.hasRoot) this.bad();
            if (char === '"') { this.token = 'string'; this.pieces = []; index++; continue; }
            if (char === '{' || char === '[') { if (this.stack.length >= 128) this.bad(); this.stack.push({ value: char === '[' ? [] : {}, array: char === '[', phase: char === '[' ? 'value' : 'key', initial: true }); index++; continue; }
            this.token = 'literal'; this.pieces = [];
        }
    }
    finish() { if (this.token === 'literal') this.literal(); if (this.token || this.stack.length || !this.hasRoot) this.bad(); return this.root; }
}

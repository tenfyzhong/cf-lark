import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
const WINDOW = 16384;
const MAX_MAIL = 25 * 1024 * 1024;
const MAX_METADATA = 1024 * 1024;
const omitted = Symbol('raw mail');
function invalid(message: string): never {
    throw new ServiceError('INVALID_UPSTREAM_RESPONSE', message, 502);
}
class Cursor {
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
    private readonly decoder = new TextDecoder('utf-8', { fatal: true });
    private input: Uint8Array = new Uint8Array(0);
    private offset = 0;
    private text = '';
    private index = 0;
    private ended = false;
    private metadataBytes = 0;
    private previousHighSurrogate = false;
    constructor(body: ReadableStream<Uint8Array>) {
        this.reader = body.getReader();
    }
    async remaining(): Promise<string> {
        while (this.index === this.text.length && !this.ended) {
            if (this.offset === this.input.length) {
                const next = await this.reader.read();
                if (next.done) {
                    this.text = this.decoder.decode();
                    this.index = 0;
                    this.ended = true;
                    break;
                }
                this.input = next.value;
                this.offset = 0;
            }
            const end = Math.min(this.input.length, this.offset + WINDOW);
            this.text = this.decoder.decode(
                this.input.subarray(this.offset, end),
                { stream: true },
            );
            this.index = 0;
            this.offset = end;
        }
        return this.text.slice(this.index);
    }
    advance(length: number, metadata = true): void {
        if (metadata)
            for (let i = this.index; i < this.index + length; i++) {
                const code = this.text.charCodeAt(i);
                this.metadataBytes +=
                    code < 128
                        ? 1
                        : code < 2048
                          ? 2
                          : code >= 0xdc00 &&
                              code <= 0xdfff &&
                              this.previousHighSurrogate
                            ? 1
                            : 3;
                this.previousHighSurrogate = code >= 0xd800 && code <= 0xdbff;
                if (this.metadataBytes > MAX_METADATA)
                    invalid('Raw mail JSON metadata exceeds 1 MiB.');
            }
        this.index += length;
    }
    async peek(): Promise<string> {
        return (await this.remaining())[0] ?? '';
    }
    async take(metadata = true): Promise<string> {
        const char = await this.peek();
        if (!char) invalid('Incomplete raw mail JSON envelope.');
        this.advance(1, metadata);
        return char;
    }
    async whitespace(): Promise<void> {
        for (;;) {
            const rest = await this.remaining(),
                match = /^[\x20\t\r\n]+/.exec(rest);
            if (!match) return;
            this.advance(match[0].length);
        }
    }
    async expect(char: string, metadata = true): Promise<void> {
        if ((await this.take(metadata)) !== char)
            invalid('Malformed raw mail JSON envelope.');
    }
    async cancel(reason?: unknown): Promise<void> {
        try {
            await this.reader.cancel(reason);
        } catch {
            /* Preserve the original parsing or cancellation error. */
        }
    }
}
class Base64URL {
    private quartet = '';
    private ended = false;
    private output = new Uint8Array(WINDOW);
    private length = 0;
    private total = 0;
    *feed(text: string): Generator<Uint8Array> {
        if ((this.ended && text.length) || /[^A-Za-z0-9_=-]/.test(text))
            invalid('Invalid raw mail base64url character or padding.');
        const combined = this.quartet + text,
            complete = combined.slice(0, Math.floor(combined.length / 4) * 4);
        this.quartet = combined.slice(complete.length);
        if (!complete) return;
        const padding = complete.indexOf('=');
        if (padding >= 0) {
            const count = complete.length - padding,
                alphabet =
                    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
            if (
                count > 2 ||
                !/^=+$/.test(complete.slice(padding)) ||
                this.quartet.length
            )
                invalid('Invalid raw mail base64url padding.');
            const last = alphabet.indexOf(complete[padding - 1]!);
            if (count === 2 ? last & 15 : last & 3)
                invalid('Noncanonical raw mail base64url trailing bits.');
            this.ended = true;
        }
        let decoded: string;
        try {
            decoded = atob(complete.replaceAll('-', '+').replaceAll('_', '/'));
        } catch {
            return invalid('Invalid raw mail base64url encoding.');
        }
        this.total += decoded.length;
        if (this.total > MAX_MAIL) invalid('Decoded raw mail exceeds 25 MiB.');
        for (let i = 0; i < decoded.length; i++) {
            this.output[this.length++] = decoded.charCodeAt(i);
            if (this.length === WINDOW) {
                const chunk = this.output;
                this.output = new Uint8Array(WINDOW);
                this.length = 0;
                yield chunk;
            }
        }
    }
    *finish(): Generator<Uint8Array> {
        if (this.quartet) {
            if (this.quartet.length === 1 || this.quartet.includes('='))
                invalid('Incomplete raw mail base64url encoding.');
            yield* this.feed('='.repeat(4 - this.quartet.length));
        }
        if (this.length) yield this.output.subarray(0, this.length);
    }
}
class Envelope {
    rawCount = 0;
    constructor(readonly cursor: Cursor) {}
    async string(): Promise<string> {
        await this.cursor.expect('"');
        let spelling = '"';
        for (;;) {
            const char = await this.cursor.take();
            spelling += char;
            if (char === '"') break;
            if (char === '\\') spelling += await this.cursor.take();
            else if (char.charCodeAt(0) < 32)
                invalid('Invalid control character in raw mail JSON.');
        }
        try {
            return JSON.parse(spelling) as string;
        } catch {
            return invalid('Invalid JSON string in raw mail envelope.');
        }
    }
    async *raw(): AsyncGenerator<Uint8Array, typeof omitted> {
        if (++this.rawCount !== 1)
            invalid('Raw mail envelope contains multiple raw fields.');
        await this.cursor.expect('"');
        const decoder = new Base64URL();
        for (;;) {
            const rest = await this.cursor.remaining();
            if (!rest) invalid('Incomplete raw mail JSON string.');
            const special = /["\\\x00-\x1f]/.exec(rest),
                length = special?.index ?? rest.length;
            if (length) {
                this.cursor.advance(length, false);
                yield* decoder.feed(rest.slice(0, length));
                continue;
            }
            const char = await this.cursor.take(false);
            if (char === '"') {
                yield* decoder.finish();
                return omitted;
            }
            if (char !== '\\')
                invalid('Invalid control character in raw mail JSON string.');
            const escape = await this.cursor.take(false);
            let decoded: string;
            if (escape === 'u') {
                let digits = '';
                for (let i = 0; i < 4; i++)
                    digits += await this.cursor.take(false);
                if (!/^[0-9a-fA-F]{4}$/.test(digits))
                    invalid('Invalid Unicode escape in raw mail JSON.');
                decoded = String.fromCharCode(Number.parseInt(digits, 16));
            } else {
                const escapes: Record<string, string> = {
                    '"': '"',
                    '\\': '\\',
                    '/': '/',
                    b: '\b',
                    f: '\f',
                    n: '\n',
                    r: '\r',
                    t: '\t',
                };
                if (!Object.hasOwn(escapes, escape))
                    invalid('Invalid escape in raw mail JSON.');
                decoded = escapes[escape]!;
            }
            yield* decoder.feed(decoded);
        }
    }
    async *value(
        path: string[] = [],
        depth = 0,
    ): AsyncGenerator<Uint8Array, unknown> {
        if (depth > 64) invalid('Raw mail JSON nesting exceeds 64 levels.');
        await this.cursor.whitespace();
        const char = await this.cursor.peek();
        const isRaw =
            path[0] === 'data' &&
            ((path.length === 2 && path[1] === 'raw') ||
                (path.length === 3 &&
                    path[1] === 'draft' &&
                    path[2] === 'raw'));
        if (isRaw) {
            if (char !== '"')
                invalid('Raw mail field must be a base64url string.');
            return yield* this.raw();
        }
        if (char === '"') return await this.string();
        if (char === '{') {
            await this.cursor.take();
            const object: JsonObject = {},
                keys = new Set<string>();
            await this.cursor.whitespace();
            if ((await this.cursor.peek()) === '}') {
                await this.cursor.take();
                return object;
            }
            for (;;) {
                await this.cursor.whitespace();
                const key = await this.string();
                if (keys.has(key))
                    invalid('Duplicate key in raw mail JSON envelope.');
                keys.add(key);
                await this.cursor.whitespace();
                await this.cursor.expect(':');
                const value = yield* this.value([...path, key], depth + 1);
                if (value !== omitted)
                    Object.defineProperty(object, key, {
                        value,
                        enumerable: true,
                        configurable: true,
                        writable: true,
                    });
                await this.cursor.whitespace();
                const separator = await this.cursor.take();
                if (separator === '}') return object;
                if (separator !== ',')
                    invalid('Malformed raw mail JSON object.');
            }
        }
        if (char === '[') {
            await this.cursor.take();
            const array: unknown[] = [];
            await this.cursor.whitespace();
            if ((await this.cursor.peek()) === ']') {
                await this.cursor.take();
                return array;
            }
            for (;;) {
                array.push(
                    yield* this.value(
                        [...path, String(array.length)],
                        depth + 1,
                    ),
                );
                await this.cursor.whitespace();
                const separator = await this.cursor.take();
                if (separator === ']') return array;
                if (separator !== ',')
                    invalid('Malformed raw mail JSON array.');
            }
        }
        let token = '';
        for (;;) {
            const next = await this.cursor.peek();
            if (!next || /[\x20\t\r\n,}\]]/.test(next)) break;
            token += await this.cursor.take();
        }
        if (
            !/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)$/.test(
                token,
            )
        )
            invalid('Invalid scalar in raw mail JSON envelope.');
        return JSON.parse(token);
    }
}
/** Stream bytes first, but require metadata success before publishing extracted content. */
export function extractRawMailStream(response: Response): {
    body: ReadableStream<Uint8Array>;
    metadata: Promise<JsonObject>;
} {
    if (!response.ok || !response.body)
        invalid('Raw mail response has no successful JSON body.');
    const cursor = new Cursor(response.body),
        envelope = new Envelope(cursor);
    let resolve!: (metadata: JsonObject) => void,
        reject!: (error: unknown) => void;
    const metadata = new Promise<JsonObject>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    void metadata.catch(() => {});
    const iterator = (async function* (): AsyncGenerator<Uint8Array> {
        try {
            const result = yield* envelope.value();
            await cursor.whitespace();
            if (await cursor.peek())
                invalid('Trailing content after raw mail JSON envelope.');
            if (!result || typeof result !== 'object' || Array.isArray(result))
                invalid('Raw mail envelope must be an object.');
            const root = result as JsonObject;
            if (root.code !== 0)
                throw new ServiceError(
                    'LARK_API_ERROR',
                    'Raw mail request did not return success.',
                    502,
                    { upstreamCode: root.code },
                );
            if (
                envelope.rawCount !== 1 ||
                !root.data ||
                typeof root.data !== 'object' ||
                Array.isArray(root.data)
            )
                invalid('Raw mail response is missing its raw field.');
            resolve(root.data as JsonObject);
        } catch (error) {
            const failure =
                error instanceof ServiceError
                    ? error
                    : new ServiceError(
                          'INVALID_UPSTREAM_RESPONSE',
                          'Raw mail response could not be decoded.',
                          502,
                      );
            reject(failure);
            throw failure;
        } finally {
            await cursor.cancel();
        }
    })();
    return {
        metadata,
        body: new ReadableStream<Uint8Array>(
            {
                async pull(controller) {
                    try {
                        const next = await iterator.next();
                        if (next.done) controller.close();
                        else controller.enqueue(next.value);
                    } catch (error) {
                        controller.error(error);
                    }
                },
                async cancel(reason) {
                    const error = new ServiceError(
                        'CANCELLED',
                        'Raw mail stream was cancelled.',
                        499,
                    );
                    reject(error);
                    await cursor.cancel(reason);
                    await iterator.return(undefined);
                },
            },
            { highWaterMark: 0 },
        ),
    };
}

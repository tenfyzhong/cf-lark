import type { ArtifactFiles } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
import { invalid, type Data } from './common';
export interface RetainedMailPart {
    marker: string;
    file: Data;
    size: number;
}
const encoder = new TextEncoder();
const bytes = (value: string) => Uint8Array.from(value, (c) => c.charCodeAt(0));
const binary = (value: Uint8Array) => {
    let out = '';
    for (let i = 0; i < value.length; i += 32768)
        out += String.fromCharCode(...value.subarray(i, i + 32768));
    return out;
};
async function* lines(
    body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
    const reader = body.getReader();
    let carry = '';
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done) break;
            carry += binary(next.value);
            let index: number;
            while ((index = carry.indexOf('\n')) >= 0) {
                yield carry.slice(0, index + 1);
                carry = carry.slice(index + 1);
            }
            if (carry.length > 1024 * 1024)
                invalid('MIME line exceeds the bounded parser limit.');
        }
        if (carry) yield carry;
    } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
function readable(
    iterator: AsyncGenerator<Uint8Array>,
): ReadableStream<Uint8Array> {
    return new ReadableStream({
        async pull(controller) {
            try {
                const next = await iterator.next();
                if (next.done) controller.close();
                else controller.enqueue(next.value);
            } catch (error) {
                controller.error(error);
            }
        },
        async cancel() {
            await iterator.return(undefined);
        },
    });
}
function decoded(encoding: string): TransformStream<Uint8Array, Uint8Array> {
    let carry = '';
    return new TransformStream({
        transform(chunk, c) {
            let text = carry + binary(chunk);
            if (encoding === 'base64') {
                text = text.replace(/\s/g, '');
                const count = text.length - (text.length % 4);
                try {
                    if (count) c.enqueue(bytes(atob(text.slice(0, count))));
                } catch {
                    invalid('Invalid MIME base64 payload.');
                }
                carry = text.slice(count);
                return;
            }
            if (encoding === 'quoted-printable') {
                let output = '',
                    i = 0;
                for (; i < text.length; i++) {
                    if (text[i] !== '=') {
                        output += text[i];
                        continue;
                    }
                    if (i + 2 >= text.length) break;
                    if (text.slice(i + 1, i + 3) === '\r\n') {
                        i += 2;
                        continue;
                    }
                    if (text[i + 1] === '\n') {
                        i++;
                        continue;
                    }
                    if (/^[a-f0-9]{2}$/i.test(text.slice(i + 1, i + 3))) {
                        output += String.fromCharCode(
                            parseInt(text.slice(i + 1, i + 3), 16),
                        );
                        i += 2;
                    } else output += '=';
                }
                carry = text.slice(i);
                if (output) c.enqueue(bytes(output));
                return;
            }
            c.enqueue(chunk);
            carry = '';
        },
        flush(c) {
            if (!carry) return;
            if (encoding === 'base64') {
                try {
                    c.enqueue(bytes(atob(carry)));
                } catch {
                    invalid('Invalid MIME base64 payload.');
                }
            } else c.enqueue(bytes(carry));
        },
    });
}
/** Partition MIME attachment payloads before the pure parser allocates bodies. */
export async function partitionMailMIME(
    body: ReadableStream<Uint8Array>,
    context: CommandContext,
    artifacts: ArtifactFiles,
): Promise<{
    raw: string;
    parts: RetainedMailPart[];
    baseAdjustment: number;
}> {
    if (!artifacts.ingest)
        invalid('Streaming artifact ingestion is unavailable.');
    const iterator = lines(body),
        boundaries = new Set<string>(),
        parts: RetainedMailPart[] = [];
    let pending: string | undefined,
        output = '',
        headers = true,
        baseAdjustment = 0;
    const next = async () => {
        if (pending !== undefined) {
            const value = pending;
            pending = undefined;
            return { done: false as const, value };
        }
        return iterator.next();
    };
    const boundary = (line: string) => {
        const value = line.trimEnd();
        for (const name of boundaries)
            if (value === `--${name}` || value === `--${name}--`)
                return { closing: value === `--${name}--` };
        return undefined;
    };
    const append = (text: string) => {
        output += text;
        if (output.length > 8 * 1024 * 1024)
            invalid(
                'MIME text and headers exceed the bounded pure-engine input size.',
            );
    };
    try {
        for (;;) {
            const line = await next();
            if (line.done) break;
            if (headers) {
                let header = line.value;
                while (
                    header !== '\n' &&
                    header !== '\r\n' &&
                    !header.endsWith('\n\n') &&
                    !header.endsWith('\r\n\r\n')
                ) {
                    const item = await next();
                    if (item.done) break;
                    header += item.value;
                    if (header.length > 65536)
                        invalid('MIME headers exceed 64 KiB.');
                }
                const unfolded = header.replace(/\r?\n[\t ]+/g, ' '),
                    field = (name: string) =>
                        unfolded
                            .match(new RegExp(`^${name}:\\s*(.*)$`, 'im'))?.[1]
                            ?.trim() ?? '',
                    type = field('Content-Type'),
                    encoding = field('Content-Transfer-Encoding').toLowerCase(),
                    disposition = field('Content-Disposition');
                const boundaryName = type.match(
                    /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i,
                );
                if (boundaryName)
                    boundaries.add(boundaryName[1] ?? boundaryName[2]!);
                const attachment =
                    !/^multipart\//i.test(type) &&
                    (/^(attachment|inline)\b/i.test(disposition) ||
                        !!field('Content-ID'));
                if (!attachment) {
                    append(header);
                    headers = false;
                    continue;
                }
                let prefix = new Uint8Array(),
                    count = 0;
                async function* payload(): AsyncGenerator<Uint8Array> {
                    let previous: string | undefined;
                    for (;;) {
                        const item = await next();
                        if (item.done) {
                            if (previous) yield bytes(previous);
                            return;
                        }
                        if (boundary(item.value)) {
                            pending = item.value;
                            if (previous)
                                yield bytes(previous.replace(/\r?\n$/, ''));
                            return;
                        }
                        if (previous) yield bytes(previous);
                        previous = item.value;
                    }
                }
                const stream = readable(payload())
                    .pipeThrough(decoded(encoding))
                    .pipeThrough(
                        new TransformStream<Uint8Array, Uint8Array>({
                            transform(chunk, c) {
                                count += chunk.length;
                                if (prefix.length < 512) {
                                    const take = chunk.subarray(
                                            0,
                                            512 - prefix.length,
                                        ),
                                        joined = new Uint8Array(
                                            prefix.length + take.length,
                                        );
                                    joined.set(prefix);
                                    joined.set(take, prefix.length);
                                    prefix = joined;
                                }
                                c.enqueue(chunk);
                            },
                        }),
                    );
                const artifact = await artifacts.ingest(
                        context.grant.id,
                        25 * 1024 * 1024,
                        stream,
                    ),
                    suffix = encoder.encode(
                        `cf-lark-retained-${crypto.randomUUID()}`,
                    ),
                    placeholder = new Uint8Array(prefix.length + suffix.length);
                placeholder.set(prefix);
                placeholder.set(suffix, prefix.length);
                const marker = btoa(binary(placeholder))
                    .match(/.{1,76}/g)!
                    .join('\n');
                let normalized = header.replace(/\r\n/g, '\n');
                normalized = /^Content-Transfer-Encoding:/im.test(normalized)
                    ? normalized.replace(
                          /^Content-Transfer-Encoding:[^\n]*(?:\n[ \t][^\n]*)*/im,
                          'Content-Transfer-Encoding: base64',
                      )
                    : normalized.replace(
                          /\n\n$/,
                          '\nContent-Transfer-Encoding: base64\n\n',
                      );
                append(normalized + marker + '\n');
                parts.push({
                    marker,
                    file: {
                        id: artifact.id,
                        name: 'retained.bin',
                        internal: true,
                    },
                    size: count,
                });
                baseAdjustment +=
                    Math.floor((count * 4 + 2) / 3) -
                    Math.floor((placeholder.length * 4 + 2) / 3);
                headers = false;
                continue;
            }
            append(line.value);
            const match = boundary(line.value);
            if (match && !match.closing) headers = true;
        }
    } finally {
        await iterator.return(undefined);
    }
    return { raw: btoa(output), parts, baseAdjustment };
}

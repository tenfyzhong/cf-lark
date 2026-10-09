import { authorize } from '../../domain/authorization';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
import type { MailTransformer } from '../../ports/mail';
import { invalid, type Data } from './common';
export interface MailStreamPart {
    file: Data;
    kind: 'attachment' | 'inline';
}
const encoder = new TextEncoder();
function base64(bytes: Uint8Array): string {
    let text = '';
    for (let offset = 0; offset < bytes.length; offset += 32768)
        text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(text);
}
function decode(value: string): Uint8Array {
    return Uint8Array.from(
        atob(value.replace(/-/g, '+').replace(/_/g, '/')),
        (c) => c.charCodeAt(0),
    );
}
/** Bounded chunks, preserving MIME LF wrapping and padded outer base64url. */
export function base64Stream(
    url = false,
    wrap = false,
): TransformStream<Uint8Array, Uint8Array> {
    let carry = new Uint8Array(),
        line = '';
    const emit = (
        value: string,
        controller: TransformStreamDefaultController<Uint8Array>,
    ) => {
        if (url) value = value.replace(/\+/g, '-').replace(/\//g, '_');
        if (!wrap) {
            if (value) controller.enqueue(encoder.encode(value));
            return;
        }
        line += value;
        while (line.length > 76) {
            controller.enqueue(encoder.encode(line.slice(0, 76) + '\n'));
            line = line.slice(76);
        }
    };
    return new TransformStream({
        transform(chunk, controller) {
            for (let offset = 0; offset < chunk.length; offset += 49152) {
                const part = chunk.subarray(offset, offset + 49152),
                    bytes = new Uint8Array(carry.length + part.length);
                bytes.set(carry);
                bytes.set(part, carry.length);
                const end = bytes.length - (bytes.length % 3);
                emit(base64(bytes.subarray(0, end)), controller);
                carry = bytes.slice(end);
            }
        },
        flush(controller) {
            if (carry.length) emit(base64(carry), controller);
            if (wrap && line) controller.enqueue(encoder.encode(line));
        },
    });
}
function fromGenerator(
    generator: AsyncGenerator<Uint8Array>,
): ReadableStream<Uint8Array> {
    return new ReadableStream({
        async pull(controller) {
            try {
                const next = await generator.next();
                if (next.done) controller.close();
                else controller.enqueue(next.value);
            } catch (error) {
                controller.error(error);
            }
        },
        async cancel() {
            await generator.return(undefined);
        },
    });
}
async function* chunks(
    stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
    const reader = stream.getReader();
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done) return;
            yield next.value;
        }
    } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
export async function streamMailDraftJSON(
    input: Data,
    parts: MailStreamPart[],
    context: CommandContext,
    artifacts: ArtifactFiles,
    pure: MailTransformer,
): Promise<ReadableStream<Uint8Array>> {
    const slots: {
            marker: string;
            file: Data;
            size: number;
        }[] = [],
        attachments: Data[] = [],
        inline: Data[] = [];
    for (const part of parts) {
        const placeholder = await mailPartPlaceholder(
            part.file,
            part.kind,
            context,
            artifacts,
        );
        slots.push(placeholder.slot);
        (part.kind === 'inline' ? inline : attachments).push(placeholder.part);
    }
    const result = (await pure.processMail({
        ...input,
        operation: 'build-eml',
        attachments,
        inline,
    })) as Data;
    return streamMailSkeletonJSON(result.raw, slots, context, artifacts, true);
}
export function streamMailSkeletonJSON(
    raw: string,
    slots: {
        marker: string;
        file: Data;
        size: number;
    }[],
    context: CommandContext,
    artifacts: ArtifactFiles,
    requireAll = false,
): ReadableStream<Uint8Array> {
    const skeleton = new TextDecoder().decode(decode(raw));
    const ordered = slots
        .map((slot) => ({ ...slot, offset: skeleton.indexOf(slot.marker) }))
        .filter((slot) => requireAll || slot.offset >= 0)
        .sort((a, b) => a.offset - b.offset);
    if (
        ordered.some(
            (slot) =>
                slot.offset < 0 ||
                skeleton.indexOf(
                    slot.marker,
                    slot.offset + slot.marker.length,
                ) >= 0,
        )
    )
        invalid('MIME attachment placeholder is missing or ambiguous.');
    const finalSize =
        encoder.encode(skeleton).length +
        ordered.reduce((sum, slot) => {
            const encodedSize = 4 * Math.ceil(slot.size / 3),
                wrappedSize =
                    encodedSize + Math.max(0, Math.ceil(encodedSize / 76) - 1);
            return (
                sum +
                wrappedSize -
                slot.marker.length -
                (slot.size === 0 ? 1 : 0)
            );
        }, 0);
    if (finalSize > 25 * 1024 * 1024)
        invalid('Raw EML exceeds the 25 MiB limit.');
    async function* mime(): AsyncGenerator<Uint8Array> {
        let offset = 0;
        for (const slot of ordered) {
            yield encoder.encode(skeleton.slice(offset, slot.offset));
            const response = await artifacts.read(
                context.grant.id,
                slot.file.id,
            );
            if (!response.body)
                invalid('Attachment artifact body is unavailable.');
            let count = 0;
            const counted = response.body.pipeThrough(
                new TransformStream<Uint8Array, Uint8Array>({
                    transform(chunk, controller) {
                        count += chunk.length;
                        if (count > slot.size)
                            invalid('Attachment artifact size mismatch.');
                        controller.enqueue(chunk);
                    },
                    flush() {
                        if (count !== slot.size)
                            invalid('Attachment artifact size mismatch.');
                    },
                }),
            );
            yield* chunks(counted.pipeThrough(base64Stream(false, true)));
            offset =
                slot.offset + slot.marker.length + (slot.size === 0 ? 1 : 0);
        }
        yield encoder.encode(skeleton.slice(offset));
    }
    async function* json(): AsyncGenerator<Uint8Array> {
        yield encoder.encode('{"raw":"');
        yield* chunks(fromGenerator(mime()).pipeThrough(base64Stream(true)));
        yield encoder.encode('"}');
    }
    return fromGenerator(json());
}
export async function mailPartPlaceholder(
    file: Data,
    kind: 'attachment' | 'inline',
    context: CommandContext,
    artifacts: ArtifactFiles,
): Promise<{
    part: Data;
    slot: {
        marker: string;
        file: Data;
        size: number;
    };
}> {
    if (!file.internal)
        authorize(
            context.grant,
            { ...context.selection, domain: 'artifact', risk: 'read' },
            Date.now(),
        );
    const metadata = await artifacts.stat(context.grant.id, file.id);
    let prefix = new Uint8Array();
    if (kind === 'inline' && metadata.size) {
        const response = await artifacts.read(context.grant.id, file.id, {
            offset: 0,
            length: Math.min(512, metadata.size),
        });
        prefix = new Uint8Array(await response.arrayBuffer());
    }
    const suffix = encoder.encode(`cf-lark-${crypto.randomUUID()}`),
        placeholder = new Uint8Array(prefix.length + suffix.length);
    placeholder.set(prefix);
    placeholder.set(suffix, prefix.length);
    const value = base64(placeholder),
        marker = value.match(/.{1,76}/g)!.join('\n');
    return {
        slot: { marker, file, size: metadata.size },
        part: {
            name: file.name,
            data: value,
            ...(file.cid ? { cid: file.cid } : {}),
            ...(file.content_type ? { content_type: file.content_type } : {}),
        },
    };
}

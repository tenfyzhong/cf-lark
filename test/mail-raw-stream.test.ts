import { describe, expect, it, vi } from 'vitest';
import { extractRawMailStream } from '../src/capabilities/mail/raw-stream';
function response(text: string, width = 7) {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    return new Response(
        new ReadableStream<Uint8Array>({
            pull(controller) {
                if (offset === bytes.length) return controller.close();
                controller.enqueue(
                    bytes.slice(
                        offset,
                        (offset = Math.min(bytes.length, offset + width)),
                    ),
                );
            },
        }),
    );
}
async function read(text: string, width?: number) {
    const result = extractRawMailStream(response(text, width));
    const body = await new Response(result.body).text();
    return { body, metadata: await result.metadata };
}
describe('streamed raw mail JSON decoding', () => {
    it('decodes escaped, unpadded base64url across single-byte chunks and retains metadata', async () => {
        expect(
            await read(
                '{"code":0,"data":{"id":"m","raw":"SGV\\u0073bG8tXw"},"msg":"ok"}',
                1,
            ),
        ).toEqual({ body: 'Hello-_', metadata: { id: 'm' } });
    });
    it('supports draft raw data, padding and UTF-8 metadata', async () => {
        expect(
            await read(
                '{"data":{"draft":{"raw":"YQ==","id":"draft"},"subject":"café"},"code":0}',
                1,
            ),
        ).toEqual({
            body: 'a',
            metadata: { draft: { id: 'draft' }, subject: 'café' },
        });
    });
    it.each(['Y', 'YQ=', 'YQ===', 'YQ==YQ==', 'Y*==', 'YR=='])(
        'rejects malformed base64url %s',
        async (raw) => {
            const result = extractRawMailStream(
                response(JSON.stringify({ code: 0, data: { raw } })),
            );
            await expect(
                new Response(result.body).arrayBuffer(),
            ).rejects.toThrow();
            await expect(result.metadata).rejects.toThrow();
        },
    );
    it.each([
        '{"code":0,"data":{"raw":"YQ=="}} trailing',
        '{"code":0,"data":{"raw":"YQ=="},"code":1}',
        '{"code":1,"data":{"raw":"YQ=="}}',
        '{"code":0,"data":{}}',
        '{"code":0,"data":{"raw":"YQ==","draft":{"raw":"YQ=="}}}',
        '{"code":0,"data":{"raw":"YQ=="}',
    ])(
        'rejects the entire envelope after raw bytes when its suffix is invalid: %s',
        async (input) => {
            const result = extractRawMailStream(response(input));
            await expect(
                new Response(result.body).arrayBuffer(),
            ).rejects.toThrow();
            await expect(result.metadata).rejects.toThrow();
        },
    );
    it('bounds metadata independently of raw mail size', async () => {
        const result = extractRawMailStream(
            response(
                JSON.stringify({
                    code: 0,
                    extra: 'x'.repeat(1024 * 1024),
                    data: { raw: 'YQ==' },
                }),
                8192,
            ),
        );
        await expect(new Response(result.body).arrayBuffer()).rejects.toThrow(
            'metadata',
        );
        await expect(result.metadata).rejects.toThrow('metadata');
    });
    it('cancels the upstream stream and metadata when its consumer stops', async () => {
        const cancel = vi.fn();
        const result = extractRawMailStream(
            new Response(
                new ReadableStream({
                    start(c) {
                        c.enqueue(
                            new TextEncoder().encode(
                                '{"code":0,"data":{"raw":"' +
                                    'YWFh'.repeat(10000),
                            ),
                        );
                    },
                    cancel,
                }),
            ),
        );
        const reader = result.body.getReader();
        expect((await reader.read()).value!.byteLength).toBeLessThanOrEqual(
            16384,
        );
        await reader.cancel();
        expect(cancel).toHaveBeenCalled();
        await expect(result.metadata).rejects.toThrow('cancel');
    });
});
it('does not treat dotted property names as a raw field path', async () => {
    const result = extractRawMailStream(
        response('{"code":0,"data":{},"data.raw":"YQ=="}'),
    );
    await expect(new Response(result.body).arrayBuffer()).rejects.toThrow(
        'missing',
    );
    await expect(result.metadata).rejects.toThrow('missing');
});
it('enforces the decoded limit incrementally without collecting the encoded payload', async () => {
    const encoder = new TextEncoder(),
        block = encoder.encode('YWFh'.repeat(4096));
    let remaining = 26 * 1024 * 1024,
        started = false;
    const cancel = vi.fn();
    const upstream = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (!started) {
                started = true;
                controller.enqueue(encoder.encode('{"code":0,"data":{"raw":"'));
            } else if (remaining > 0) {
                remaining -= (block.length * 3) / 4;
                controller.enqueue(block);
            } else {
                controller.enqueue(encoder.encode('"}}'));
                controller.close();
            }
        },
        cancel,
    });
    const result = extractRawMailStream(new Response(upstream));
    const reader = result.body.getReader();
    let bytes = 0;
    await expect(
        (async () => {
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done) return;
                expect(chunk.value.byteLength).toBeLessThanOrEqual(16384);
                bytes += chunk.value.byteLength;
            }
        })(),
    ).rejects.toThrow('25 MiB');
    expect(bytes).toBeLessThanOrEqual(25 * 1024 * 1024);
    expect(cancel).toHaveBeenCalled();
    await expect(result.metadata).rejects.toThrow('25 MiB');
}, 30000);
it('decodes the URL-specific alphabet into exact binary bytes', async () => {
    const result = extractRawMailStream(
        response('{"code":0,"data":{"raw":"-_8="}}', 1),
    );
    expect([
        ...new Uint8Array(await new Response(result.body).arrayBuffer()),
    ]).toEqual([251, 255]);
    await expect(result.metadata).resolves.toEqual({});
});

import { expect, it, vi } from 'vitest';
import { streamMailDraftJSON } from '../src/capabilities/mail/stream';
it('streams MIME attachment payloads through both base64 layers with exact byte preservation', async () => {
    const bytes = new Uint8Array(257);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const read = vi.fn(
            async (_owner: string) =>
                new Response(
                    new ReadableStream({
                        start(c) {
                            c.enqueue(bytes.slice(0, 1));
                            c.enqueue(bytes.slice(1, 103));
                            c.enqueue(bytes.slice(103));
                            c.close();
                        },
                    }),
                ),
        ),
        stat = vi.fn().mockResolvedValue({ size: bytes.length });
    const pure = {
        processMail: vi.fn(async (input: any) => ({
            raw: btoa(
                'Headers\r\n\r\n' +
                    input.attachments
                        .map((p: any) => p.data + '\r\n')
                        .join('') +
                    '--end',
            )
                .replace(/=/g, '')
                .replace(/\+/g, '-')
                .replace(/\//g, '_'),
        })),
    };
    const stream = await streamMailDraftJSON(
        { subject: 'S' },
        [
            {
                file: { id: 'artifact', name: 'f.txt', internal: true },
                kind: 'attachment',
            },
        ],
        { grant: { id: 'owner' } } as never,
        { read, stat } as never,
        pure,
    );
    const json = JSON.parse(await new Response(stream).text()),
        raw = atob(json.raw.replace(/-/g, '+').replace(/_/g, '/')),
        payload = raw.split('\r\n\r\n')[1]!.split('--end')[0]!.trim(),
        decoded = Uint8Array.from(atob(payload.replace(/\r?\n/g, '')), (c) =>
            c.charCodeAt(0),
        );
    expect(decoded).toEqual(bytes);
    expect(
        payload.split(/\r?\n/).every((line: string) => line.length <= 76),
    ).toBe(true);
    expect(read.mock.calls[0]![0]).toBe('owner');
    expect(
        pure.processMail.mock.calls[0]![0].attachments[0].data.length,
    ).toBeLessThan(256);
});
it('creates small MIME placeholders for large private artifact payloads', async () => {
    const { mailPartPlaceholder } = await import(
        '../src/capabilities/mail/stream'
    );
    const read = vi.fn(),
        result = await mailPartPlaceholder(
            { id: 'file', name: 'large.txt', internal: true },
            'attachment',
            { grant: { id: 'g' } } as never,
            { stat: async () => ({ size: 18000000 }), read } as never,
        );
    expect(result.slot.size).toBe(18000000);
    expect(result.part.data.length).toBeLessThan(128);
    expect(result.part.name).toBe('large.txt');
    expect(read).not.toHaveBeenCalled();
});

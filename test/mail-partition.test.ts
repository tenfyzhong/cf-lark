import { expect, it, vi } from 'vitest';
import { partitionMailMIME } from '../src/capabilities/mail/partition';
it('partitions attachment payloads while preserving headers and body text', async () => {
    const raw =
            'From: a@example.com\r\nContent-Type: multipart/mixed; boundary="x"\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nHello\r\n--x\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="f.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\nYWJj\r\n--x--\r\n',
        stored: Uint8Array[] = [];
    const ingest = vi.fn(async (_owner, _max, body) => {
        stored.push(new Uint8Array(await new Response(body).arrayBuffer()));
        return { id: 'file', size: stored.at(-1)!.length };
    });
    const result = await partitionMailMIME(
        new Response(raw).body!,
        { grant: { id: 'g' } } as never,
        { ingest } as never,
    );
    expect(result.parts).toHaveLength(1);
    expect(stored[0]).toEqual(new TextEncoder().encode('abc'));
    expect(atob(result.raw)).toContain('Hello');
    expect(atob(result.raw)).not.toContain('\nYWJj\r\n');
    expect(result.parts[0]).toMatchObject({
        file: { id: 'file', internal: true },
        size: 3,
    });
    expect(ingest.mock.calls[0]![0]).toBe('g');
});
it('restores retained payloads after a pure edit removes another attachment', async () => {
    const { streamMailSkeletonJSON } = await import(
        '../src/capabilities/mail/stream'
    );
    const raw = btoa('H\n\nSENTINEL\n\n--end'),
        stream = streamMailSkeletonJSON(
            raw,
            [
                { marker: 'SENTINEL', file: { id: 'a' }, size: 3 },
                { marker: 'REMOVED', file: { id: 'b' }, size: 3 },
            ],
            { grant: { id: 'g' } } as never,
            { read: async () => new Response('abc') } as never,
        );
    const json = JSON.parse(await new Response(stream).text());
    expect(atob(json.raw)).toBe('H\n\nYWJj\n\n--end');
});
it('preserves empty MIME leaf headers and boundary names ending in dashes', async () => {
    const raw =
        'Content-Type: multipart/mixed; boundary="x--"\n\n--x--\n\nPlain leaf\n--x--\nContent-Disposition: attachment; filename="f.txt"\nContent-Transfer-Encoding: base64\n\nYWJj\n--x----\n';
    const result = await partitionMailMIME(
        new Response(raw).body!,
        { grant: { id: 'g' } } as never,
        {
            ingest: async (
                _o: string,
                _m: number,
                stream: ReadableStream<Uint8Array>,
            ) => ({
                id: 'a',
                size: (await new Response(stream).arrayBuffer()).byteLength,
            }),
        } as never,
    );
    expect(result.parts).toHaveLength(1);
    expect(atob(result.raw)).toContain('Plain leaf');
});

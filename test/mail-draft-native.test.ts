import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { WasmDocumentParser } from '../src/infrastructure/documents/engine';
import { draftProgram } from '../src/capabilities/mail/edit';
it('streams a draft through partition, native MIME edit, and attachment restoration', async () => {
    const module = await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/mail/parser.wasm',
                    import.meta.url,
                ),
            ),
        ),
        pure = new WasmDocumentParser(module),
        built = (await pure.processMail({
            operation: 'build-eml',
            from: { address: 'a@example.com' },
            to: [{ address: 'b@example.com' }],
            subject: 'Old',
            text: 'Body',
            attachments: [{ name: 'report.txt', data: 'YWJj' }],
        })) as any;
    const storage = new Map<string, Uint8Array>();
    let counter = 0,
        saved: any;
    const ingest = async (
            _owner: string,
            _maximum: number,
            body: ReadableStream<Uint8Array>,
        ) => {
            const bytes = new Uint8Array(
                    await new Response(body).arrayBuffer(),
                ),
                id = String(++counter);
            storage.set(id, bytes);
            return { id, size: bytes.length };
        },
        artifacts = {
            ingest,
            upload: ingest,
            read: async (_owner: string, id: string) =>
                new Response(new Uint8Array(storage.get(id)!)),
            stat: async (_owner: string, id: string) => ({
                size: storage.get(id)!.length,
            }),
            remove: async (_owner: string, id: string) => {
                storage.delete(id);
            },
        },
        download = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({ code: 0, data: { raw: built.raw } }),
                ),
        ),
        request = vi
            .fn()
            .mockRejectedValue(Error('Expected streamed transport')),
        requestStream = vi.fn(async (value: any) => {
            saved = JSON.parse(await new Response(value.body).text());
            return { draft_id: 'd' };
        });
    let state: any = {
        phase: 'start',
        args: { 'draft-id': 'd', 'set-subject': 'Updated' },
    };
    for (let i = 0; i < 20; i++) {
        const result = await draftProgram(artifacts as never, pure).step(
            state,
            {
                selection: { identity: 'user' },
                grant: { id: 'g' },
                lark: { request, download, requestStream },
            } as never,
        );
        if (result.done) {
            expect(result.output).toMatchObject({
                draft_id: 'd',
                projection: { subject: 'Updated' },
            });
            break;
        }
        state = result.state;
    }
    expect(request).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledOnce();
    expect(requestStream).toHaveBeenCalledOnce();
    const result = (await pure.processMail({
        operation: 'inspect-eml',
        raw: saved.raw,
    })) as any;
    expect(result.projection.subject).toBe('Updated');
    expect(result.projection.attachments_summary).toHaveLength(1);
    expect(atob(saved.raw.replace(/-/g, '+').replace(/_/g, '/'))).toContain(
        'YWJj',
    );
});

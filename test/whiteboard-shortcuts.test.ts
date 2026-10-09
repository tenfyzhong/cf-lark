import { describe, expect, it, vi } from 'vitest';
import { whiteboardCapabilities } from '../src/capabilities/whiteboard/commands';
import type { CommandContext } from '../src/ports/capabilities';
const context = (data: unknown) =>
    ({
        lark: { request: vi.fn().mockResolvedValue(data) },
        selection: { profileId: 'p', identity: 'bot' },
        grant: {
            id: 'g',
            domains: ['whiteboard', 'artifact'],
            permissions: ['read', 'write'],
            profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }],
            expiresAt: Date.now() + 100000,
        },
    }) as unknown as CommandContext;
const store = { upload: vi.fn(), read: vi.fn(), remove: vi.fn() };
const command = (id: string) =>
    whiteboardCapabilities(store).find((c) => c.definition.id === id)!;
describe('whiteboard shortcuts', () => {
    it('validates raw envelopes and maps created IDs', async () => {
        const c = context({ ids: ['a', 'b'] });
        expect(
            await command('whiteboard.+update').execute(
                {
                    'whiteboard-token': 'a/b',
                    source: '{"nodes":[]}',
                    overwrite: true,
                    'idempotent-token': '1234567890',
                },
                c,
            ),
        ).toEqual({ created_node_ids: 'a,b' });
        expect(c.lark.request).toHaveBeenCalledWith({
            method: 'POST',
            path: '/open-apis/board/v1/whiteboards/a%2Fb/nodes',
            query: { client_token: '1234567890' },
            body: { nodes: [], overwrite: true },
        });
        await expect(
            command('whiteboard.+update').preview({
                'whiteboard-token': 'x',
                source: '{}',
            }),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('maps diagram formats and rejects malformed success', async () => {
        const c = context({ node_id: 'node' });
        expect(
            await command('docs.+whiteboard-update').execute(
                {
                    'whiteboard-token': 'x',
                    source: 'graph LR',
                    input_format: 'mermaid',
                },
                c,
            ),
        ).toEqual({ created_node_id: 'node' });
        expect(c.lark.request).toHaveBeenCalledWith(
            expect.objectContaining({
                body: {
                    plant_uml_code: 'graph LR',
                    syntax_type: 2,
                    parse_mode: 1,
                },
            }),
        );
        await expect(
            command('whiteboard.+update').execute(
                { 'whiteboard-token': 'x', source: '{"nodes":[]}' },
                context({ ids: [1] }),
            ),
        ).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
    });
    it('supports legacy code export and refuses ambiguous extraction', async () => {
        expect(
            await command('whiteboard.+query').execute(
                { 'whiteboard-token': 'x', output_as: 'code' },
                context({
                    nodes: [{ syntax: { code: 'graph LR', syntax_type: 2 } }],
                }),
            ),
        ).toEqual({ code: 'graph LR', syntax_type: 'mermaid' });
        expect(
            await command('whiteboard.+export').execute(
                { 'whiteboard-token': 'x', 'output-type': 'source' },
                context({
                    nodes: [
                        { syntax: { code: 'a', syntax_type: 1 } },
                        { syntax: { code: 'b', syntax_type: 2 } },
                    ],
                }),
            ),
        ).toEqual({
            msg: 'multiple code blocks found, cannot export directly',
        });
    });
    it('decodes SVG and preserves raw empty arrays', async () => {
        expect(
            await command('whiteboard.+export').execute(
                { 'whiteboard-token': 'x', 'output-type': 'svg' },
                context({ content: btoa('<svg/>') }),
            ),
        ).toEqual({ svg_content: '<svg/>' });
        expect(
            await command('whiteboard.+export').execute(
                { 'whiteboard-token': 'x', 'output-type': 'raw' },
                context({ nodes: [] }),
            ),
        ).toEqual({ nodes: [] });
    });
});
describe('whiteboard artifact output', () => {
    it('saves grant-owned decoded SVG bytes', async () => {
        const c = context({ content: btoa('<svg/>') });
        const upload = vi.fn(
            async (
                owner: string,
                size: number,
                stream: ReadableStream<Uint8Array>,
            ) => {
                expect(owner).toBe('g');
                expect(await new Response(stream).text()).toBe('<svg/>');
                return {
                    id: 'artifact',
                    owner,
                    size,
                    state: 'ready' as const,
                    expiresAt: 123,
                };
            },
        );
        const capability = whiteboardCapabilities({ ...store, upload }).find(
            (x) => x.definition.id === 'whiteboard.+export',
        )!;
        expect(
            await capability.execute(
                {
                    'whiteboard-token': 'x',
                    'output-type': 'svg',
                    output: 'chart.svg',
                },
                c,
            ),
        ).toMatchObject({ artifactId: 'artifact', size_bytes: 6 });
    });
    it('rejects artifact writes before fetching upstream data', async () => {
        const c = context({ content: btoa('<svg/>') });
        c.grant.permissions = ['read'];
        await expect(
            command('whiteboard.+export').execute(
                {
                    'whiteboard-token': 'x',
                    'output-type': 'svg',
                    output: 'chart.svg',
                },
                c,
            ),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(c.lark.request).not.toHaveBeenCalled();
    });
    it('streams preview bytes and checks response type and file suffix', async () => {
        const c = context({});
        const download = vi.fn().mockResolvedValue(
            new Response(new Uint8Array([1, 2, 3]), {
                headers: {
                    'content-type': 'image/png',
                    'content-length': '3',
                },
            }),
        );
        Object.assign(c.lark, { download });
        const upload = vi.fn(
            async (
                owner: string,
                size: number,
                body: ReadableStream<Uint8Array>,
            ) => {
                expect([
                    ...new Uint8Array(await new Response(body).arrayBuffer()),
                ]).toEqual([1, 2, 3]);
                return {
                    id: 'p',
                    owner,
                    size,
                    state: 'ready' as const,
                    expiresAt: 123,
                };
            },
        );
        const capability = whiteboardCapabilities({ ...store, upload }).find(
            (x) => x.definition.id === 'whiteboard.+export',
        )!;
        await capability.execute(
            {
                'whiteboard-token': 'x',
                'output-type': 'preview',
                output: 'p.png',
            },
            c,
        );
        expect(upload).toHaveBeenCalledTimes(1);
        download.mockResolvedValueOnce(
            new Response('{}', {
                headers: { 'content-type': 'application/json' },
            }),
        );
        await expect(
            capability.execute(
                {
                    'whiteboard-token': 'x',
                    'output-type': 'preview',
                    output: 'p.png',
                },
                c,
            ),
        ).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
        download.mockResolvedValueOnce(
            new Response('x', { headers: { 'content-type': 'image/jpeg' } }),
        );
        await expect(
            capability.execute(
                {
                    'whiteboard-token': 'x',
                    'output-type': 'preview',
                    output: 'p.png',
                },
                c,
            ),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('accepts successful converter output but rejects failed conversion', async () => {
        const c = context({ ids: [] });
        expect(
            await command('whiteboard.+update').execute(
                {
                    'whiteboard-token': 'x',
                    source: '{"code":0,"data":{"to":"openapi","result":{"nodes":[]}}}',
                },
                c,
            ),
        ).toEqual({ created_node_ids: '' });
        await expect(
            command('whiteboard.+update').preview({
                'whiteboard-token': 'x',
                source: '{"code":1,"data":{"to":"openapi","result":{"nodes":[]}}}',
            }),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});
it('uses streaming ingestion for unknown-length previews', async () => {
    const c = context({});
    Object.assign(c.lark, {
        download: vi.fn(
            async () =>
                new Response('image', {
                    headers: { 'content-type': 'image/png' },
                }),
        ),
    });
    const ingest = vi.fn(
        async (
            owner: string,
            _maximum: number,
            body: ReadableStream<Uint8Array>,
        ) => ({
            id: 'stream',
            owner,
            size: (await new Response(body).text()).length,
            expiresAt: 1,
            state: 'ready' as const,
        }),
    );
    const capability = whiteboardCapabilities({ ...store, ingest }).find(
        (x) => x.definition.id === 'whiteboard.+export',
    )!;
    expect(
        await capability.execute(
            {
                'whiteboard-token': 'x',
                'output-type': 'preview',
                output: 'image.png',
            },
            c,
        ),
    ).toMatchObject({ artifactId: 'stream' });
    expect(ingest).toHaveBeenCalledTimes(1);
});

it('hydrates private source artifacts and keeps preview free of IO', async () => {
    const read = vi.fn(async () => new Response('{"nodes":[]}'));
    const capability = whiteboardCapabilities({ ...store, read }).find(
        (x) => x.definition.id === 'whiteboard.+update',
    )!;
    expect(
        await capability.preview({
            'whiteboard-token': 'board',
            source: '@source',
        }),
    ).toMatchObject({ artifact: 'source' });
    expect(read).not.toHaveBeenCalled();
    const c = context({ ids: ['node'] });
    expect(
        await capability.execute(
            { 'whiteboard-token': 'board', source: '@source' },
            c,
        ),
    ).toEqual({ created_node_ids: 'node' });
    expect(read).toHaveBeenCalledWith('g', 'source');
});

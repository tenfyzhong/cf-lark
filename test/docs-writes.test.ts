import { describe, it, expect, vi } from 'vitest';
import { docsWritePrograms } from '../src/capabilities/docs/writes';
import type { ArtifactFiles } from '../src/ports/artifacts';
import type { JsonObject } from '../src/domain/models';
import type { CommandContext } from '../src/ports/capabilities';
const files: ArtifactFiles = {
    stat: vi.fn(async (owner, id) => ({
        owner,
        id,
        size: 3,
        state: 'ready' as const,
        expiresAt: 9999999999999,
    })),
    read: vi.fn(
        async (_owner, id) =>
            new Response(id === 'draft' ? '<p>Draft</p>' : 'abc'),
    ),
    upload: vi.fn(),
    remove: vi.fn(),
};
const context = () =>
    ({
        selection: { profileId: 'p', identity: 'user', accountId: 'u' },
        grant: {
            id: 'g',
            revoked: false,
            expiresAt: Date.now() + 100000,
            profiles: [
                {
                    profileId: 'p',
                    identities: ['user', 'bot'],
                    accounts: ['u'],
                },
            ],
            domains: ['docs', 'artifact'],
            permissions: ['read', 'write'],
        },
        lark: {
            brand: 'lark',
            request: vi.fn(),
            upload: vi.fn(async () => ({ file_token: 'uploaded' })),
        },
    }) as unknown as CommandContext;
async function run(state: JsonObject, c: CommandContext) {
    const p = docsWritePrograms(files)[0]!;
    for (let i = 0; i < 60; i++) {
        const before = (c.lark.request as ReturnType<typeof vi.fn>).mock.calls
            .length;
        const r = await p.step(state, c);
        expect(
            (c.lark.request as ReturnType<typeof vi.fn>).mock.calls.length -
                before,
        ).toBeLessThanOrEqual(1);
        if (r.done) return r.output;
        state = r.state;
    }
    throw Error('Unbounded workflow');
}
describe('resumable document writes', () => {
    it('hydrates artifact content, checkpoints async creation, and adds brand URL', async () => {
        const c = context();
        const request = c.lark.request as ReturnType<typeof vi.fn>;
        request
            .mockResolvedValueOnce({
                task: { task_id: 'task', status: 'processing' },
            })
            .mockResolvedValueOnce({
                task: {
                    task_id: 'task',
                    status: 'succeeded',
                    result: {
                        create_document: JSON.stringify({
                            document: { document_id: 'doc' },
                        }),
                    },
                },
            });
        expect(
            await run(
                {
                    phase: 'start',
                    name: 'create',
                    args: { content: '@draft', title: 'Title' },
                },
                c,
            ),
        ).toMatchObject({
            document: {
                document_id: 'doc',
                url: 'https://www.larksuite.com/docx/doc',
            },
        });
        expect(request.mock.calls[0]![0].body.content).toBe(
            '<title>Title</title>\n<p>Draft</p>',
        );
        expect(
            request.mock.calls.filter(([x]) => x.method === 'POST'),
        ).toHaveLength(1);
    });
    it('correlates placeholders then uploads and binds a file resource', async () => {
        const c = context();
        const request = c.lark.request as ReturnType<typeof vi.fn>;
        request.mockImplementation(async (req) => {
            if (req.path === '/open-apis/docs_ai/v1/documents') {
                const marker = /path="([^"]+)"/u.exec(req.body.content)![1];
                return {
                    document: {
                        document_id: 'doc',
                        new_blocks: [
                            {
                                block_id: 'block',
                                block_token: marker,
                                block_type: 'file',
                            },
                        ],
                    },
                };
            }
            return {};
        });
        const result = await run(
            {
                phase: 'start',
                name: 'create',
                args: { content: '<source path="@file" name="data.csv"/>' },
            },
            c,
        );
        expect(result).toMatchObject({ document: { document_id: 'doc' } });
        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
                path: '/open-apis/docx/v1/documents/doc/blocks/batch_update',
                body: {
                    requests: [
                        {
                            block_id: 'block',
                            replace_file: { token: 'uploaded' },
                        },
                    ],
                },
            }),
        );
    });
    it('hydrates reference maps and maps append updates to end insertion', async () => {
        const c = context();
        (c.lark.request as ReturnType<typeof vi.fn>).mockResolvedValue({
            document: { document_id: 'doc' },
        });
        await run(
            {
                phase: 'start',
                name: 'update',
                args: {
                    doc: 'doc',
                    command: 'append',
                    content: '<p>new</p>',
                    'reference-map': '{"users":{"u":{"user_id":"x"}}}',
                },
            },
            c,
        );
        expect(c.lark.request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'PATCH',
                body: expect.objectContaining({
                    command: 'block_insert_after',
                    block_id: '-1',
                    reference_map: { users: { u: { user_id: 'x' } } },
                }),
            }),
        );
    });
    it('does not upload when returned markers cannot be correlated', async () => {
        const c = context();
        (c.lark.request as ReturnType<typeof vi.fn>).mockResolvedValue({
            document: { document_id: 'doc', new_blocks: [] },
        });
        const result = await run(
            {
                phase: 'start',
                name: 'create',
                args: { content: '<source path="@file"/>' },
            },
            c,
        );
        expect(result).toMatchObject({
            result: 'failed',
            resource_failures: [{ status: 'correlation_failed' }],
        });
        expect((c.lark as any).upload).not.toHaveBeenCalled();
    });
});

it('retains large artifact-backed request bodies without duplicating input arguments', async () => {
    const text = '<p>' + 'word '.repeat(100000) + '</p>';
    const store = new Map<string, string>([['draft', text]]);
    const largeFiles = {
        ...files,
        stat: vi.fn(async (owner: string, id: string) => ({
            owner,
            id,
            size: store.get(id)!.length,
            state: 'ready' as const,
            expiresAt: 9999999999999,
        })),
        read: vi.fn(
            async (_owner: string, id: string) => new Response(store.get(id)),
        ),
        upload: vi.fn(
            async (
                owner: string,
                size: number,
                body: ReadableStream<Uint8Array>,
            ) => {
                store.set('payload', await new Response(body).text());
                return {
                    owner,
                    size,
                    id: 'payload',
                    state: 'ready' as const,
                    expiresAt: 9999999999999,
                };
            },
        ),
    };
    const c = context();
    (c.lark.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        document: { document_id: 'doc' },
    });
    const p = docsWritePrograms(largeFiles)[0]!;
    let state: JsonObject = {
        phase: 'start',
        name: 'create',
        args: { content: '@draft' },
    };
    for (let i = 0; i < 15; i++) {
        const step = await p.step(state, c);
        if (step.done) break;
        state = step.state;
        expect((state.args as JsonObject).content).toBeUndefined();
    }
    expect(c.lark.request).toHaveBeenCalledWith(
        expect.objectContaining({
            body: expect.objectContaining({ content: text }),
        }),
    );
});

it('verifies empty file placeholders and their sole-source figure before revision-guarded cleanup', async () => {
    const c = context();
    (c.lark as any).upload.mockRejectedValue(new Error('Upload rejected.'));
    const request = c.lark.request as ReturnType<typeof vi.fn>;
    request.mockImplementation(async (req) => {
        if (
            req.method === 'POST' &&
            req.path === '/open-apis/docs_ai/v1/documents'
        ) {
            const marker = /path="([^"]+)"/u.exec(req.body.content)![1];
            return {
                document: {
                    document_id: 'doc',
                    revision_id: 7,
                    new_blocks: [
                        {
                            block_id: 'block',
                            block_token: marker,
                            block_type: 23,
                        },
                    ],
                },
            };
        }
        if (req.path.endsWith('/blocks/block'))
            return {
                block: {
                    block_id: 'block',
                    block_type: 23,
                    parent_id: 'figure',
                    file: { token: '' },
                },
            };
        if (req.path.endsWith('/blocks/figure'))
            return {
                block: {
                    block_id: 'figure',
                    block_type: 33,
                    children: ['block'],
                },
            };
        return { document: { document_id: 'doc', revision_id: 8 } };
    });
    const result = await run(
        {
            phase: 'start',
            name: 'create',
            args: { content: '<source path="@file"/>' },
        },
        c,
    );
    expect(result).toMatchObject({
        result: 'failed',
        resource_failures: [{ cleanup_status: 'succeeded' }],
    });
    expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
            method: 'PATCH',
            path: '/open-apis/docs_ai/v1/documents/doc',
            body: {
                format: 'xml',
                command: 'block_delete',
                block_id: 'figure',
                revision_id: 7,
            },
        }),
    );
});

it('rejects explicit legacy creation flags even when empty', async () => {
    const { prepareDocumentCreate } =
        await import('../src/capabilities/shortcuts/documents');
    for (const key of ['markdown', 'folder-token', 'wiki-node', 'wiki-space'])
        expect(() =>
            prepareDocumentCreate({ title: 'Title', [key]: '' }),
        ).toThrow('legacy');
    expect(
        prepareDocumentCreate({
            title: 'Title',
            'api-version': 'v1',
            format: 'json',
            json: true,
        }),
    ).toMatchObject({ path: '/open-apis/docs_ai/v1/documents' });
});

it('retries definite transient media upload failures without replaying document creation', async () => {
    const { ServiceError } = await import('../src/domain/errors');
    const c = context();
    (c.lark as any).upload
        .mockRejectedValueOnce(
            new ServiceError('UPSTREAM_ERROR', 'Throttled', 502, {
                upstreamCode: 99991400,
            }),
        )
        .mockResolvedValue({ file_token: 'uploaded' });
    const request = c.lark.request as ReturnType<typeof vi.fn>;
    request.mockImplementation(async (req) => {
        if (
            req.method === 'POST' &&
            req.path === '/open-apis/docs_ai/v1/documents'
        ) {
            const marker = /path="([^"]+)"/u.exec(req.body.content)![1];
            return {
                document: {
                    document_id: 'doc',
                    new_blocks: [
                        {
                            block_id: 'block',
                            block_token: marker,
                            block_type: 'file',
                        },
                    ],
                },
            };
        }
        return {};
    });
    expect(
        await run(
            {
                phase: 'start',
                name: 'create',
                args: { content: '<source path="@file"/>' },
            },
            c,
        ),
    ).not.toHaveProperty('resource_failures');
    expect((c.lark as any).upload).toHaveBeenCalledTimes(2);
    expect(
        request.mock.calls.filter(
            ([r]) => r.path === '/open-apis/docs_ai/v1/documents',
        ),
    ).toHaveLength(1);
});

it('reconciles a failed binding response by reading the token before reporting failure', async () => {
    const { ServiceError } = await import('../src/domain/errors');
    const c = context();
    const request = c.lark.request as ReturnType<typeof vi.fn>;
    request.mockImplementation(async (req) => {
        if (
            req.method === 'POST' &&
            req.path === '/open-apis/docs_ai/v1/documents'
        ) {
            const marker = /path="([^"]+)"/u.exec(req.body.content)![1];
            return {
                document: {
                    document_id: 'doc',
                    new_blocks: [
                        {
                            block_id: 'block',
                            block_token: marker,
                            block_type: 'file',
                        },
                    ],
                },
            };
        }
        if (req.method === 'PATCH')
            throw new ServiceError('UPSTREAM_ERROR', 'Response failed', 502, {
                upstreamStatus: 503,
            });
        if (req.method === 'GET')
            return {
                block: {
                    block_id: 'block',
                    block_type: 23,
                    file: { token: 'uploaded' },
                },
            };
        return {};
    });
    expect(
        await run(
            {
                phase: 'start',
                name: 'create',
                args: { content: '<source path="@file"/>' },
            },
            c,
        ),
    ).not.toHaveProperty('resource_failures');
    expect(
        request.mock.calls.filter(([r]) => r.method === 'PATCH'),
    ).toHaveLength(1);
});

it('returns the latest revision after resource binding', async () => {
    const c = context();
    const request = c.lark.request as ReturnType<typeof vi.fn>;
    request.mockImplementation(async (req) => {
        if (
            req.method === 'POST' &&
            req.path === '/open-apis/docs_ai/v1/documents'
        ) {
            const marker = /path="([^"]+)"/u.exec(req.body.content)![1];
            return {
                document: {
                    document_id: 'doc',
                    revision_id: 7,
                    new_blocks: [
                        {
                            block_id: 'block',
                            block_token: marker,
                            block_type: 'file',
                        },
                    ],
                },
            };
        }
        return { document_revision_id: 8 };
    });
    expect(
        await run(
            {
                phase: 'start',
                name: 'create',
                args: { content: '<source path="@file"/>' },
            },
            c,
        ),
    ).toMatchObject({ document: { revision_id: 8 } });
});

it('retries a definite bind failure only after verifying the placeholder is empty', async () => {
    const { ServiceError } = await import('../src/domain/errors');
    const c = context();
    const request = c.lark.request as ReturnType<typeof vi.fn>;
    let bindings = 0;
    request.mockImplementation(async (req) => {
        if (
            req.method === 'POST' &&
            req.path === '/open-apis/docs_ai/v1/documents'
        ) {
            const marker = /path="([^"]+)"/u.exec(req.body.content)![1];
            return {
                document: {
                    document_id: 'doc',
                    new_blocks: [
                        {
                            block_id: 'block',
                            block_token: marker,
                            block_type: 'file',
                        },
                    ],
                },
            };
        }
        if (req.method === 'PATCH' && ++bindings === 1)
            throw new ServiceError('UPSTREAM_ERROR', 'Throttled', 502, {
                upstreamStatus: 429,
            });
        if (req.method === 'GET')
            return {
                block: {
                    block_id: 'block',
                    block_type: 23,
                    file: { token: '' },
                },
            };
        return {};
    });
    expect(
        await run(
            {
                phase: 'start',
                name: 'create',
                args: { content: '<source path="@file"/>' },
            },
            c,
        ),
    ).not.toHaveProperty('resource_failures');
    expect(bindings).toBe(2);
    expect(request.mock.calls.filter(([r]) => r.method === 'GET')).toHaveLength(
        1,
    );
    expect((c.lark as any).upload).toHaveBeenCalledTimes(1);
});

it('backs off repeated read-only task failures without losing the pending ticket', async () => {
    const { ServiceError } = await import('../src/domain/errors');
    const c = context();
    (c.lark.request as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ServiceError('UPSTREAM_UNAVAILABLE', 'Timeout', 502),
    );
    const program = docsWritePrograms(files)[0]!;
    const state = {
        phase: 'poll',
        name: 'create',
        taskId: 'task',
        polls: 1,
        pollDelay: 4000,
        result: { task: { task_id: 'task', status: 'processing' } },
    };
    const step = await program.step(state, c);
    expect(step).toMatchObject({
        done: false,
        retryAfter: 8000,
        state: { taskId: 'task', polls: 2 },
    });
});

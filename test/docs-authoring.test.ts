import { describe, it, expect, vi } from 'vitest';
import { docsAuthoringPrograms } from '../src/capabilities/docs/authoring';
import type { ArtifactFiles } from '../src/ports/artifacts';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
import { ServiceError } from '../src/domain/errors';
const files: ArtifactFiles = {
    stat: vi.fn(async (owner, id) => ({
        owner,
        id,
        size: 3,
        state: 'ready' as const,
        expiresAt: 9999999999999,
    })),
    read: vi.fn(async () => new Response('img')),
    upload: vi.fn(),
    remove: vi.fn(),
};
function context() {
    return {
        selection: { profileId: 'p', identity: 'bot' },
        grant: {
            id: 'g',
            revoked: false,
            expiresAt: Date.now() + 100000,
            profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }],
            domains: ['docs', 'artifact'],
            permissions: ['read', 'write'],
        },
        lark: {
            request: vi.fn(async () => ({}) as JsonObject),
            upload: vi.fn(async () => ({ file_token: 'media' })),
        },
    } satisfies CommandContext & { lark: { upload: unknown } };
}
async function run(state: JsonObject, c: CommandContext) {
    const p = docsAuthoringPrograms(files)[0]!;
    for (let i = 0; i < 30; i++) {
        const before = (c.lark.request as ReturnType<typeof vi.fn>).mock.calls
            .length;
        const result = await p.step(state, c);
        expect(
            (c.lark.request as ReturnType<typeof vi.fn>).mock.calls.length -
                before,
        ).toBeLessThanOrEqual(1);
        if (result.done) return result.output;
        state = result.state;
    }
    throw Error('Too many steps');
}
describe('document media authoring', () => {
    it('uses nested file block for upload and binding', async () => {
        const c = context();
        c.lark.request
            .mockResolvedValueOnce({
                block: { block_id: 'root', children: ['existing'] },
            })
            .mockResolvedValueOnce({
                children: [{ block_id: 'wrapper', children: ['inner'] }],
            })
            .mockResolvedValueOnce({});
        const result = await run(
            {
                phase: 'start',
                command: 'media-insert',
                args: {
                    doc: 'doc',
                    file: 'artifact',
                    type: 'file',
                    'file-view': 'preview',
                },
            },
            c,
        );
        expect(result).toMatchObject({
            block_id: 'wrapper',
            file_token: 'media',
        });
        expect(c.lark.upload).toHaveBeenCalledWith(
            expect.objectContaining({
                fields: expect.objectContaining({
                    parent_node: 'inner',
                    parent_type: 'docx_file',
                }),
            }),
        );
        expect(c.lark.request).toHaveBeenLastCalledWith(
            expect.objectContaining({
                body: {
                    requests: [
                        { block_id: 'inner', replace_file: { token: 'media' } },
                    ],
                },
            }),
        );
    });
    it('checkpoints rollback after definite upload failure', async () => {
        const c = context();
        c.lark.request
            .mockResolvedValueOnce({ block: { children: [] } })
            .mockResolvedValueOnce({
                children: [{ block_id: 'block' }],
                document_revision_id: 2,
            })
            .mockResolvedValueOnce({
                block: { children: ['concurrent', 'block'] },
                document_revision_id: 3,
            })
            .mockResolvedValueOnce({});
        c.lark.upload.mockRejectedValue(
            new ServiceError('UPSTREAM_ERROR', 'Rejected', 502),
        );
        expect(
            await run(
                {
                    phase: 'start',
                    command: 'media-insert',
                    args: { doc: 'doc', file: 'artifact' },
                },
                c,
            ),
        ).toMatchObject({
            status: 'failed',
            rollback: 'succeeded',
            block_id: 'block',
        });
        expect(c.lark.request).toHaveBeenLastCalledWith({
            method: 'DELETE',
            path: '/open-apis/docx/v1/documents/doc/blocks/doc/children/batch_delete',
            query: { document_revision_id: 3 },
            body: { start_index: 1, end_index: 2 },
        });
    });
    it('updates cover offsets after upload and preserves token', async () => {
        const c = context();
        expect(
            await run(
                {
                    phase: 'start',
                    command: 'resource-update',
                    args: {
                        doc: 'doc',
                        file: 'artifact',
                        'offset-ratio-x': 0.3,
                    },
                },
                c,
            ),
        ).toMatchObject({ updated: true, file_token: 'media' });
        expect(c.lark.request).toHaveBeenCalledWith({
            method: 'PATCH',
            path: '/open-apis/docx/v1/documents/doc',
            body: {
                update_cover: {
                    cover: { token: 'media', offset_ratio_x: 0.3 },
                },
            },
        });
    });
});

it('rejects unsupported cover response MIME before writing an artifact', async () => {
    const c = context();
    const remote = {
        stream: vi.fn(
            async () =>
                new Response('<html/>', {
                    headers: {
                        'Content-Type': 'text/html',
                        'Content-Length': '7',
                    },
                }),
        ),
        read: vi.fn(),
        put: vi.fn(),
    };
    const p = docsAuthoringPrograms(files, remote)[0]!;
    await expect(
        p.step(
            {
                phase: 'remote',
                command: 'resource-update',
                args: { doc: 'doc', url: 'https://image.test/file' },
            },
            c,
        ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});

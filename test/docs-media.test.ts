import { describe, it, expect, vi } from 'vitest';
import { docsMediaCapabilities } from '../src/capabilities/docs/media';
import { ServiceError } from '../src/domain/errors';
import type { CommandContext } from '../src/ports/capabilities';
const artifacts = {
    upload: vi.fn(async (owner: string, size: number) => ({
        owner,
        size,
        id: 'artifact',
        state: 'ready' as const,
        expiresAt: 1,
    })),
    read: vi.fn(),
    remove: vi.fn(),
};
const get = (name: string) =>
    docsMediaCapabilities(artifacts).find(
        (c) => c.definition.id === `docs.+${name}`,
    )!;
const context = () =>
    ({
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
            request: vi.fn().mockResolvedValue({ auth_result: true }),
            download: vi.fn().mockResolvedValue(
                new Response('img', {
                    headers: {
                        'content-length': '3',
                        'content-type': 'image/png',
                    },
                }),
            ),
        },
    }) as unknown as CommandContext;
describe('document media and cover operations', () => {
    it('refuses explicitly denied media export before download', async () => {
        const c = context();
        c.lark.request = vi.fn().mockResolvedValue({ auth_result: false });
        await expect(
            get('media-download').execute({ token: 't', output: 'image' }, c),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(
            (c.lark as unknown as { download: unknown }).download,
        ).not.toHaveBeenCalled();
    });
    it('continues after a missing export-check scope and saves artifact', async () => {
        const c = context();
        c.lark.request = vi.fn().mockRejectedValue(
            new ServiceError('UPSTREAM_ERROR', 'Scope', 502, {
                upstreamCode: 99991672,
            }),
        );
        expect(
            await get('media-download').execute(
                { token: 't', output: 'image' },
                c,
            ),
        ).toMatchObject({ artifact_id: 'artifact' });
    });
    it('does not patch an empty cover', async () => {
        const c = context();
        c.lark.request = vi.fn().mockResolvedValue({ document: {} });
        expect(await get('resource-delete').execute({ doc: 'd' }, c)).toEqual({
            document_id: 'd',
            type: 'cover',
            deleted: false,
            already_empty: true,
        });
        expect(c.lark.request).toHaveBeenCalledTimes(1);
    });
    it('resolves a Wiki cover and clears it exactly once', async () => {
        const c = context();
        c.lark.request = vi
            .fn()
            .mockResolvedValueOnce({
                node: { obj_type: 'docx', obj_token: 'doc' },
            })
            .mockResolvedValueOnce({
                document: { cover: { token: 'cover', offset_ratio_x: 0.5 } },
            })
            .mockResolvedValueOnce({});
        expect(
            await get('resource-delete').execute(
                { doc: 'https://x/wiki/node' },
                c,
            ),
        ).toMatchObject({ deleted: true, previous_cover: { token: 'cover' } });
        expect(c.lark.request).toHaveBeenLastCalledWith({
            method: 'PATCH',
            path: '/open-apis/docx/v1/documents/doc',
            body: { update_cover: { cover: null } },
        });
    });
});

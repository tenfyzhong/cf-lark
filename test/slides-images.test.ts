import { describe, it, expect, vi } from 'vitest';
import { slidesImageCapabilities } from '../src/capabilities/slides/images';
import { ServiceError } from '../src/domain/errors';
import type { CommandContext } from '../src/ports/capabilities';
const files = {
    upload: vi.fn(
        async (
            owner: string,
            size: number,
            body: ReadableStream<Uint8Array>,
        ) => {
            expect(await new Response(body).text()).toBe('png');
            return {
                owner,
                size,
                id: 'artifact',
                state: 'ready' as const,
                expiresAt: 1,
            };
        },
    ),
    read: vi.fn(),
    remove: vi.fn(),
};
const get = (name: string) =>
    slidesImageCapabilities(files).find(
        (x) => x.definition.id === `slides.+${name}`,
    )!;
const context = () =>
    ({
        selection: { profileId: 'p', identity: 'bot' },
        grant: {
            id: 'g',
            revoked: false,
            expiresAt: Date.now() + 100000,
            profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }],
            domains: ['slides', 'artifact'],
            permissions: ['read', 'write'],
        },
        lark: {
            request: vi.fn().mockResolvedValue({
                slide_images: [
                    {
                        slide_id: 's',
                        slide_number: 1,
                        format: 1,
                        data: btoa('png'),
                    },
                ],
            }),
        },
    }) as unknown as CommandContext;
describe('Slides image output', () => {
    it('deduplicates aliases and decodes screenshots to private artifacts', async () => {
        const c = context();
        expect(
            await get('screenshot').execute(
                { presentation: 'd', 'slide-ids': ['s', 's'] },
                c,
            ),
        ).toMatchObject({
            screenshots: [
                { artifactId: 'artifact', slide_id: 's', format: 'png' },
            ],
        });
        expect(c.lark.request).toHaveBeenCalledWith({
            method: 'POST',
            path: '/open-apis/slides_ai/v1/xml_presentations/d/slide_images',
            body: { slide_ids: ['s'] },
        });
    });
    it('rejects conflicting selectors, output and render options', async () => {
        for (const args of [
            { presentation: 'd', 'slide-id': ['s'], 'slide-number': [1] },
            { content: '<slide/>', presentation: 'd' },
            { presentation: 'd', 'slide-id': ['a', 'b'], output: 'image.png' },
            { content: '<slide/>', output: 'x.txt' },
        ])
            await expect(get('screenshot').preview(args)).rejects.toMatchObject(
                { code: 'INVALID_ARGUMENTS' },
            );
    });
    it('uses permission-only preview fallback', async () => {
        const c = context();
        const download = vi
            .fn()
            .mockRejectedValueOnce(
                new ServiceError('UPSTREAM_HTTP_ERROR', 'Denied', 502, {
                    upstreamStatus: 403,
                }),
            )
            .mockResolvedValueOnce(
                new Response('png', {
                    headers: {
                        'content-type': 'image/png',
                        'content-length': '3',
                    },
                }),
            );
        Object.assign(c.lark, { download });
        expect(
            await get('media-download').execute({ 'file-token': 'token' }, c),
        ).toMatchObject({ artifactId: 'artifact', source: 'preview' });
        expect(download).toHaveBeenLastCalledWith({
            path: '/open-apis/drive/v1/medias/token/preview_download',
            query: { preview_type: '16' },
        });
        download
            .mockReset()
            .mockRejectedValue(
                new ServiceError('OUTCOME_UNCERTAIN', 'Network failed'),
            );
        await expect(
            get('media-download').execute({ 'file-token': 'token' }, c),
        ).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
        expect(download).toHaveBeenCalledTimes(1);
    });
});

it('uses source preview for the pinned Drive permission code', async () => {
    const c = context();
    const download = vi
        .fn()
        .mockRejectedValueOnce(
            new ServiceError('UPSTREAM_ERROR', 'Forbidden', 502, {
                upstreamCode: 1061004,
            }),
        )
        .mockResolvedValue(
            new Response('png', {
                headers: { 'Content-Type': 'image/png', 'Content-Length': '3' },
            }),
        );
    Object.assign(c.lark, { download });
    expect(
        await get('media-download').execute({ 'file-token': 'token' }, c),
    ).toMatchObject({ source: 'preview' });
    expect(download).toHaveBeenCalledTimes(2);
});

it('hydrates render XML from a private artifact before requesting a screenshot', async () => {
    const read = vi.fn(async () => new Response('<slide/>'));
    const cap = slidesImageCapabilities({ ...files, read }).find(
        (x) => x.definition.id === 'slides.+screenshot',
    )!;
    const c = context();
    (c.lark.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        slide_image: { format: 1, data: btoa('png') },
    });
    await cap.execute({ content: '@xml' }, c);
    expect(read).toHaveBeenCalledWith('g', 'xml');
    expect(c.lark.request).toHaveBeenCalledWith(
        expect.objectContaining({
            path: '/open-apis/slides_ai/v1/slide_image/render',
            body: { content: '<slide/>' },
        }),
    );
});

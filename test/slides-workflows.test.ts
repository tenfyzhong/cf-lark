import { describe, it, expect, vi } from 'vitest';
import {
    slidesPrograms,
    slidesWorkflowCapabilities,
} from '../src/capabilities/slides/workflows';
import type { ArtifactFiles } from '../src/ports/artifacts';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
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
            profiles: [
                { profileId: 'p', identities: ['bot'], accounts: ['user'] },
            ],
            domains: ['slides', 'artifact'],
            permissions: ['read', 'write'],
        },
        lark: {
            request: vi.fn(async (req): Promise<JsonObject> =>
                req.path.endsWith('xml_presentations')
                    ? { xml_presentation_id: 'deck' }
                    : req.path.endsWith('/slide')
                      ? { slide_id: 'new', revision_id: 4 }
                      : {},
            ),
            upload: vi.fn(async () => ({ file_token: 'image' })),
        },
    } satisfies CommandContext & { lark: { upload: unknown } };
}
async function run(state: JsonObject, c: CommandContext) {
    const p = slidesPrograms(files)[0]!;
    for (let i = 0; i < 40; i++) {
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
describe('checkpointed Slides authoring', () => {
    it('creates pages, deduplicates image artifacts and grants bot access', async () => {
        const c = context();
        const out = await run(
            {
                phase: 'start',
                command: 'create',
                args: {
                    title: 'A & B',
                    slide: [
                        '<slide><img src="@art"/></slide>',
                        '<slide><img src="@art"/></slide>',
                    ],
                },
            },
            c,
        );
        expect(c.lark.upload).toHaveBeenCalledTimes(1);
        expect(out).toMatchObject({
            xml_presentation_id: 'deck',
            slides_added: 2,
            images_uploaded: 1,
            permission_grant: { status: 'granted' },
        });
        expect(c.lark.request.mock.calls[0]![0].body).toMatchObject({
            xml_presentation: {
                content: expect.stringContaining('<title>A &amp; B</title>'),
            },
        });
        expect(c.lark.request).toHaveBeenCalledWith(
            expect.objectContaining({
                body: {
                    slide: { content: '<slide><img src="image"/></slide>' },
                    lint_xml: true,
                },
                query: { revision_id: -1 },
            }),
        );
    });
    it('checks malformed pages before creation', async () => {
        const c = context();
        await expect(
            run(
                {
                    phase: 'start',
                    command: 'create',
                    args: { slide: ['<slide>'] },
                },
                c,
            ),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(c.lark.request).not.toHaveBeenCalled();
    });
    it('creates replacement before deleting and chains the revision', async () => {
        const c = context();
        const out = await run(
            {
                phase: 'start',
                command: 'replace-pages',
                args: {
                    presentation: 'deck',
                    pages: '[{"slide_id":"old","content":"<slide/>"}]',
                },
            },
            c,
        );
        expect(c.lark.request.mock.calls.map(([req]) => req.method)).toEqual([
            'POST',
            'DELETE',
        ]);
        expect(c.lark.request.mock.calls[1]![0].query).toEqual({
            slide_id: 'old',
            revision_id: 4,
        });
        expect(out).toMatchObject({
            results: [
                {
                    old_slide_id: 'old',
                    new_slide_id: 'new',
                    status: 'replaced',
                },
            ],
        });
    });
    it('validate-only performs no write', async () => {
        const c = context();
        expect(
            await run(
                {
                    phase: 'start',
                    command: 'replace-pages',
                    args: {
                        presentation: 'deck',
                        pages: '[{"slide_id":"old","content":"<slide/>"}]',
                        'validate-only': true,
                    },
                },
                c,
            ),
        ).toMatchObject({ validated: true });
        expect(c.lark.request).not.toHaveBeenCalled();
    });
    it('registers resumable authoring and media upload commands', () => {
        expect(
            slidesWorkflowCapabilities(files, {
                start: vi.fn(),
                resume: vi.fn(),
            }).map((x) => x.definition.id),
        ).toEqual([
            'slides.+create',
            'slides.+replace-pages',
            'slides.+media-upload',
        ]);
    });
});
describe('Slides artifact-backed mutation inputs', () => {
    it('hydrates XML and uploads placeholders before updating a page', async () => {
        const c = context();
        const backed = {
            ...files,
            read: vi.fn(
                async (_owner: string, id: string) =>
                    new Response(
                        id === 'xml'
                            ? '<slide><img src="@art"/></slide>'
                            : 'img',
                    ),
            ),
            stat: vi.fn(async (owner: string, id: string) => ({
                owner,
                id,
                size: id === 'xml' ? 35 : 3,
                state: 'ready' as const,
                expiresAt: 9999999999999,
            })),
        };
        const program = slidesPrograms(backed)[0]!;
        let state: JsonObject = {
            phase: 'start',
            command: 'update-slide',
            args: { presentation: 'deck', 'slide-id': 's', content: '@xml' },
        };
        let done = false;
        for (let i = 0; i < 30; i++) {
            const result = await program.step(state, c);
            if (result.done) {
                done = true;
                break;
            }
            state = result.state;
        }
        expect(done).toBe(true);
        expect(c.lark.request).toHaveBeenLastCalledWith(
            expect.objectContaining({
                body: {
                    lint_xml: true,
                    parts: [
                        {
                            action: 'block_replace',
                            block_id: 's',
                            replacement:
                                '<slide id="s"><img src="image"/></slide>',
                        },
                    ],
                },
            }),
        );
    });
});
it('returns the selected brand presentation URL', async () => {
    const c = context();
    Object.assign(c.lark, { brand: 'lark' });
    expect(
        await run(
            { phase: 'start', command: 'create', args: { title: 'Title' } },
            c,
        ),
    ).toMatchObject({ url: 'https://www.larksuite.com/slides/deck' });
});

it('continues replacement after a definite create failure only when requested', async () => {
    const { ServiceError } = await import('../src/domain/errors');
    const c = context();
    c.lark.request
        .mockRejectedValueOnce(
            new ServiceError('UPSTREAM_ERROR', 'Lint failed', 502),
        )
        .mockResolvedValueOnce({ slide_id: 'new', revision_id: 4 })
        .mockResolvedValueOnce({ revision_id: 5 });
    expect(
        await run(
            {
                phase: 'start',
                command: 'replace-pages',
                args: {
                    presentation: 'deck',
                    pages: JSON.stringify([
                        { slide_id: 'a', content: '<slide/>' },
                        { slide_id: 'b', content: '<slide/>' },
                    ]),
                    'continue-on-error': true,
                },
            },
            c,
        ),
    ).toMatchObject({
        status: 'partial_failure',
        results: [
            { old_slide_id: 'a', status: 'create_failed' },
            { old_slide_id: 'b', status: 'replaced' },
        ],
    });
    expect(c.lark.request.mock.calls.map(([r]) => r.method)).toEqual([
        'POST',
        'POST',
        'DELETE',
    ]);
});
it('never continues after an uncertain slide creation response', async () => {
    const { ServiceError } = await import('../src/domain/errors');
    const c = context();
    c.lark.request.mockRejectedValueOnce(
        new ServiceError('OUTCOME_UNCERTAIN', 'Disconnected', 502),
    );
    await expect(
        run(
            {
                phase: 'start',
                command: 'replace-pages',
                args: {
                    presentation: 'deck',
                    pages: JSON.stringify([
                        { slide_id: 'a', content: '<slide/>' },
                        { slide_id: 'b', content: '<slide/>' },
                    ]),
                    'continue-on-error': true,
                },
            },
            c,
        ),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
    expect(c.lark.request).toHaveBeenCalledTimes(1);
});
it('reports replacement page IDs when deleting an old page fails', async () => {
    const { ServiceError } = await import('../src/domain/errors');
    const c = context();
    c.lark.request
        .mockResolvedValueOnce({ slide_id: 'new', revision_id: 4 })
        .mockRejectedValueOnce(
            new ServiceError('UPSTREAM_ERROR', 'Deletion rejected', 502),
        );
    expect(
        await run(
            {
                phase: 'start',
                command: 'replace-pages',
                args: {
                    presentation: 'deck',
                    pages: '[{"slide_id":"old","content":"<slide/>"}]',
                },
            },
            c,
        ),
    ).toMatchObject({
        status: 'partial_failure',
        results: [
            {
                old_slide_id: 'old',
                new_slide_id: 'new',
                status: 'delete_failed',
            },
        ],
    });
});

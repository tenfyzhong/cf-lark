import { describe, it, expect, vi } from 'vitest';
import { slidesCapabilities } from '../src/capabilities/slides/commands';
import type { CommandContext } from '../src/ports/capabilities';
const store = { upload: vi.fn(), read: vi.fn(), remove: vi.fn() };
const get = (name: string) =>
    slidesCapabilities(store).find(
        (c) => c.definition.id === `slides.+${name}`,
    )!;
const context = (...responses: unknown[]) =>
    ({
        lark: { request: vi.fn(async () => responses.shift()) },
        selection: { profileId: 'p', identity: 'bot' },
        grant: {},
    }) as unknown as CommandContext;
describe('Slides read and history shortcuts', () => {
    it('resolves wiki paths and preserves pagination', async () => {
        const c = context(
            { node: { obj_type: 'slides', obj_token: 'deck' } },
            { items: [1], has_more: true, page_token: 'next' },
        );
        expect(
            await get('history-list').execute(
                {
                    url: 'https://example.test/wiki/node?from=x',
                    'page-size': 5,
                    'page-token': 'previous',
                },
                c,
            ),
        ).toEqual({ items: [1], has_more: true, page_token: 'next' });
        expect(c.lark.request).toHaveBeenLastCalledWith({
            method: 'GET',
            path: '/open-apis/slides_ai/v1/xml_presentations/deck/histories',
            query: { page_size: 5, page_token: 'previous' },
        });
    });
    it('rejects spoofed URLs and non-slide wiki objects before mutation', async () => {
        await expect(
            get('history-list').preview({
                presentation: 'https://x/docx/a?next=/slides/b',
            }),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        const c = context({ node: { obj_type: 'docx', obj_token: 'd' } });
        await expect(
            get('delete-slide').execute(
                { presentation: 'https://x/wiki/n', 'slide-id': 's' },
                c,
            ),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(c.lark.request).toHaveBeenCalledTimes(1);
    });
    it('validates version strings before resolving wiki', async () => {
        const c = context();
        for (const version of ['0', '-1', '1.2', '9223372036854775808'])
            await expect(
                get('history-revert').execute(
                    {
                        presentation: 'https://x/wiki/n',
                        'history-version-id': version,
                    },
                    c,
                ),
            ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(c.lark.request).not.toHaveBeenCalled();
        expect(
            await get('history-revert').preview({
                presentation: 'deck',
                'history-version-id': '9223372036854775807',
            }),
        ).toMatchObject({
            request: { body: { history_version_id: '9223372036854775807' } },
        });
    });
    it('projects individual slide XML and validates selectors', async () => {
        const c = context({
            slide: { slide_id: 'actual', content: '<slide/>' },
            revision_id: 7,
        });
        expect(
            await get('xml-get').execute(
                { presentation: 'deck', 'slide-number': 2 },
                c,
            ),
        ).toEqual({
            xml_presentation_id: 'deck',
            scope: 'slide',
            slide_id: 'actual',
            slide_number: 2,
            revision_id: 7,
            slide: {
                content: '<slide/>',
                slide_id: 'actual',
                slide_number: 2,
                revision_id: 7,
            },
        });
        await expect(
            get('xml-get').preview({
                presentation: 'deck',
                'slide-id': 's',
                'slide-number': 1,
            }),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(
            get('xml-get').preview({
                presentation: 'deck',
                'slide-id': 's',
                'remove-attr-id': true,
            }),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('deletes one slide with revision and exposes successful revision', async () => {
        const c = context({ revision_id: 0 });
        expect(
            await get('delete-slide').execute(
                { presentation: 'deck', 'slide-id': ' s ', 'revision-id': 8 },
                c,
            ),
        ).toEqual({
            xml_presentation_id: 'deck',
            slide_id: 's',
            deleted: true,
            revision_id: 0,
        });
        expect(c.lark.request).toHaveBeenCalledWith({
            method: 'DELETE',
            path: '/open-apis/slides_ai/v1/xml_presentations/deck/slide',
            query: { slide_id: 's', revision_id: 8 },
        });
    });
});

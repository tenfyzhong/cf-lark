import { describe, it, expect, vi } from 'vitest';
import { slidesMutationCapabilities } from '../src/capabilities/slides/mutations';
import type { CommandContext } from '../src/ports/capabilities';
const get = (name: string) =>
    slidesMutationCapabilities().find(
        (c) => c.definition.id === `slides.+${name}`,
    )!;
const context = () =>
    ({
        lark: {
            request: vi
                .fn()
                .mockResolvedValue({ revision_id: 9, issues: ['warning'] }),
        },
        selection: { profileId: 'p', identity: 'bot' },
        grant: {},
    }) as unknown as CommandContext;
describe('Slides XML mutations', () => {
    it('stamps page IDs and removes only direct note IDs preserving other bytes', async () => {
        const c = context();
        const content =
            '<slide><note id="old" label="a>b"/><shape id="keep"><note id="nested"/></shape><!-- <note id="comment"/> --></slide>';
        await get('update-slide').execute(
            { presentation: 'p', 'slide-id': 's', content },
            c,
        );
        expect(c.lark.request).toHaveBeenCalledWith(
            expect.objectContaining({
                body: {
                    lint_xml: true,
                    parts: [
                        {
                            action: 'block_replace',
                            block_id: 's',
                            replacement:
                                '<slide id="s"><note label="a>b"/><shape id="keep"><note id="nested"/></shape><!-- <note id="comment"/> --></slide>',
                        },
                    ],
                },
            }),
        );
    });
    it.each([
        '<slide id="wrong"/>',
        '<shape/>',
        '<slide><x></slide>',
        '<slide/><slide/>',
    ])(
        'refuses unsafe whole-page content %s before writes',
        async (content) => {
            const c = context();
            await expect(
                get('update').execute(
                    { presentation: 'p', 'slide-id': 's', content },
                    c,
                ),
            ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
            expect(c.lark.request).not.toHaveBeenCalled();
        },
    );
    it('validates new pages and carries position, revision and lint in correct fields', async () => {
        const c = context();
        await get('add-slide').execute(
            {
                presentation: 'p',
                slide: '<slide/>',
                'before-slide-id': 'a',
                'revision-id': 2,
                'no-lint': true,
            },
            c,
        );
        expect(c.lark.request).toHaveBeenCalledWith({
            method: 'POST',
            path: '/open-apis/slides_ai/v1/xml_presentations/p/slide',
            query: { revision_id: 2 },
            body: {
                slide: { content: '<slide/>' },
                before_slide_id: 'a',
                lint_xml: false,
            },
        });
        await expect(
            get('add-slide').preview({
                presentation: 'p',
                slide: '<?xml version="1.0"?><slide/>',
            }),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('normalizes part aliases, stamps target ID and returns partial results', async () => {
        const c = context();
        c.lark.request = vi.fn().mockResolvedValue({
            failed_part_index: 0,
            failed_reason: 'conflict',
            revision_id: 0,
        });
        const result = await get('replace-slide').execute(
            {
                presentation: 'p',
                'slide-id': 's',
                parts: JSON.stringify([
                    { action: 'replace', target_id: 'b', content: '<shape/>' },
                    { action: 'insert', element: '<shape/>' },
                ]),
            },
            c,
        );
        expect(c.lark.request).toHaveBeenCalledWith(
            expect.objectContaining({
                body: {
                    lint_xml: true,
                    parts: [
                        {
                            action: 'block_replace',
                            block_id: 'b',
                            replacement: '<shape id="b"/>',
                        },
                        { action: 'block_insert', insertion: '<shape/>' },
                    ],
                },
            }),
        );
        expect(result).toMatchObject({
            parts_count: 2,
            failed_part_index: 0,
            failed_reason: 'conflict',
            revision_id: 0,
        });
        await expect(
            get('replace-slide').preview({
                presentation: 'p',
                'slide-id': 's',
                parts: '[{"action":"replace","block_id":"a","target_id":"b","replacement":"<shape/>"}]',
            }),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

it('accepts namespace-qualified slide roots and strips only direct note IDs', async () => {
    const { stampXML } = await import('../src/capabilities/slides/xml');
    expect(
        stampXML(
            '<s:slide xmlns:s="urn:slide"><s:note id="old"/><s:shape><s:note id="nested"/></s:shape></s:slide>',
            'page',
            true,
        ),
    ).toBe(
        '<s:slide id="page" xmlns:s="urn:slide"><s:note/><s:shape><s:note id="nested"/></s:shape></s:slide>',
    );
});

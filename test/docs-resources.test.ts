import { describe, it, expect } from 'vitest';
import { prepareDocumentResources } from '../src/capabilities/docs/resources';
describe('hosted document resource preparation', () => {
    it('hydrates HTML5 reference data and whiteboard artifact input', async () => {
        const p = await prepareDocumentResources(
            '<html5-block path="@html"/><whiteboard type="mermaid" path="@graph"/>',
            'xml',
            {},
            async (id) =>
                id === 'html' ? '<html>demo</html>' : 'graph TD; A-->B',
        );
        expect(p.content).toContain('data-ref="html5_1"');
        expect(p.referenceMap).toEqual({
            'html5-block': { html5_1: { data: '<html>demo</html>' } },
        });
        expect(p.content).toContain('graph TD; A--&gt;B');
    });
    it('correlates image and file uploads through unique markers', async () => {
        const p = await prepareDocumentResources(
            '<img path="@image" alt="Demo"/><source path="@file" name="data.csv"/>',
            'xml',
            {},
            async () => '',
        );
        expect(p.resources).toMatchObject([
            { kind: 'image', artifact: 'image' },
            { kind: 'file', artifact: 'file', name: 'data.csv' },
        ]);
        expect(p.content).toContain('caption="Demo"');
        expect(p.resources[0]!.marker).not.toBe(p.resources[1]!.marker);
    });
    it('keeps fenced and inline Markdown examples inert', async () => {
        const p = await prepareDocumentResources(
            '```xml\n<img path="@example"/>\n```\n`<img path="@inline"/>`\n![demo](@real)',
            'markdown',
            {},
            async () => '',
        );
        expect(p.resources).toHaveLength(1);
        expect(p.resources[0]!.artifact).toBe('real');
        expect(p.content).toContain('<img path="@example"/>');
    });
    it.each([
        '<html5-block data="reserved"/>',
        '<img path="@a" href="https://x.test/a"/>',
        '<source path="@a" name="../bad"/>',
        '<html5-block data-ref="missing"/>',
    ])('rejects invalid resource input %s', async (content) => {
        await expect(
            prepareDocumentResources(content, 'xml', {}, async () => ''),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

describe('fetched HTML5 resources', () => {
    it('spills only large HTML entries to private artifacts', async () => {
        const { exportDocumentResources } =
            await import('../src/capabilities/docs/resources');
        const saved: string[] = [];
        const data = {
            document: {
                content:
                    '<html5-block data-ref="big"/><html5-block data-ref="small"/>',
                reference_map: {
                    'html5-block': {
                        big: { data: 'x'.repeat(1025) },
                        small: { data: 'small' },
                    },
                },
            },
        };
        await exportDocumentResources(data, 'xml', async (text) => {
            saved.push(text);
            return 'html-artifact';
        });
        expect(data.document.reference_map['html5-block'].big).toEqual({
            path: '@html-artifact',
        });
        expect(saved).toHaveLength(1);
    });
    it('rejects missing referenced data before saving anything', async () => {
        const { exportDocumentResources } =
            await import('../src/capabilities/docs/resources');
        await expect(
            exportDocumentResources(
                {
                    document: {
                        content: '<html5-block data-ref="missing"/>',
                        reference_map: {},
                    },
                },
                'xml',
                async () => 'x',
            ),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

it('preserves XML comments, CDATA and Markdown raw-code elements', async () => {
    const xml =
        '<!-- <img path="@hidden"/> --><![CDATA[<img path="@hidden2"/>]]><img path="@real"/>';
    const result = await prepareDocumentResources(
        xml,
        'xml',
        {},
        async () => '',
    );
    expect(result.resources).toHaveLength(1);
    const md = await prepareDocumentResources(
        '<pre><img path="@example"/></pre>\n![alt](@real "Title")',
        'markdown',
        {},
        async () => '',
    );
    expect(md.resources).toHaveLength(1);
    expect(md.content).toContain('caption="alt" title="Title"');
});
it('rejects local reference-style Markdown images like the CLI', async () => {
    await expect(
        prepareDocumentResources(
            '![alt][demo]\n[demo]: @image',
            'markdown',
            {},
            async () => '',
        ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});

it('rejects remote image userinfo before any artifact or network read', async () => {
    await expect(
        prepareDocumentResources(
            '<img href="https://user:secret@example.test/image"/>',
            'xml',
            {},
            async () => '',
        ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});

it('embeds SVG whiteboard markup and leaves escaped Markdown resource examples untouched', async () => {
    const svg = await prepareDocumentResources(
        '<whiteboard type="svg" path="@svg"/>',
        'xml',
        {},
        async () => '<svg><path d="M0 0"/></svg>',
    );
    expect(svg.content).toContain('<whiteboard type="svg"><svg>');
    const md = await prepareDocumentResources(
        '\\![alt](@image) \\<img path="@example"/>',
        'markdown',
        {},
        async () => '',
    );
    expect(md.resources).toHaveLength(0);
});

it('parses nested Markdown image labels, angle destinations and quoted titles', async () => {
    const result = await prepareDocumentResources(
        '![A [B] C](<@image> "A title")',
        'markdown',
        {},
        async () => '',
    );
    expect(result.resources).toMatchObject([{ artifact: 'image' }]);
    expect(result.content).toContain('caption="A [B] C" title="A title"');
});

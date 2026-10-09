import { describe, it, expect, vi } from 'vitest';
import { docsCapabilities } from '../src/capabilities/docs/commands';
import type { CommandContext } from '../src/ports/capabilities';
const get = (name: string) =>
    docsCapabilities().find((c) => c.definition.id === `docs.+${name}`)!;
const context = (data: unknown = {}) =>
    ({
        lark: { request: vi.fn().mockResolvedValue(data) },
        selection: { profileId: 'p', identity: 'bot' },
        grant: {},
    }) as unknown as CommandContext;
describe('document core shortcuts', () => {
    it('maps append and supports empty replacement deletion', async () => {
        const c = context();
        await get('update').execute(
            {
                doc: 'https://x/wiki/w',
                command: 'append',
                content: 'Hello',
                'doc-format': 'markdown',
            },
            c,
        );
        expect(c.lark.request).toHaveBeenCalledWith({
            method: 'PATCH',
            path: '/open-apis/docs_ai/v1/documents/w',
            body: {
                format: 'markdown',
                command: 'block_insert_after',
                block_id: '-1',
                revision_id: -1,
                content: 'Hello',
            },
        });
        expect(
            await get('update').preview({
                doc: 'd',
                command: 'str_replace',
                pattern: 'remove',
                content: '',
            }),
        ).toMatchObject({
            body: { command: 'str_replace', pattern: 'remove' },
        });
    });
    it.each([
        {
            command: 'block_delete',
            'block-id': 'a',
            'start-block-id': 'b',
            'end-block-id': 'c',
        },
        {
            command: 'block_replace',
            'start-block-id': '-1',
            'end-block-id': 'c',
            content: 'x',
        },
        {
            command: 'block_move_after',
            'block-id': 'a',
            'src-block-ids': 'b',
            content: 'bad',
        },
        { command: 'append', content: 'x', 'reference-map': 'null' },
    ])('rejects invalid mutation before a write %j', async (args) => {
        const c = context();
        await expect(
            get('update').execute({ doc: 'd', ...args }, c),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(c.lark.request).not.toHaveBeenCalled();
    });
    it('uses share selection anchors and scope option strings', async () => {
        expect(
            await get('fetch').preview({
                doc: 'https://x/docx/d#share-block',
                'context-before': 2,
                'max-depth': 0,
                detail: 'full',
            }),
        ).toMatchObject({
            body: {
                read_option: {
                    read_mode: 'range',
                    start_block_id: 'share-block',
                    context_before: '2',
                    max_depth: '0',
                },
                export_option: {
                    export_block_id: true,
                    export_style_attrs: true,
                    export_cite_extra_data: true,
                },
            },
        });
        await expect(
            get('fetch').preview({ doc: 'd', scope: 'section' }),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('separates scoped search filters and normalizes result times', async () => {
        const c = context({
            res_units: [{ result_meta: { update_time: '1700000000000' } }],
            total: 1,
        });
        expect(
            await get('search').execute(
                {
                    filter: '{"folder_tokens":["f"],"create_time":{"start":"2024-01-01T00:00:00Z"}}',
                    'page-size': '30',
                },
                c,
            ),
        ).toMatchObject({
            results: [
                { result_meta: { update_time_iso: '2023-11-14T22:13:20Z' } },
            ],
        });
        expect(c.lark.request).toHaveBeenCalledWith(
            expect.objectContaining({
                body: {
                    query: '',
                    page_size: 20,
                    doc_filter: {
                        folder_tokens: ['f'],
                        create_time: { start: 1704067200 },
                    },
                },
            }),
        );
        await expect(
            get('search').preview({
                filter: '{"folder_tokens":["f"],"space_ids":["s"]}',
            }),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('preserves historical version precision and wait bounds', async () => {
        expect(
            await get('history-revert').preview({
                doc: 'd',
                'history-version-id': '9223372036854775807',
                'wait-timeout-ms': 0,
            }),
        ).toMatchObject({
            body: {
                history_version_id: '9223372036854775807',
                wait_timeout_ms: 0,
            },
        });
        await expect(
            get('history-list').preview({ doc: 'https://x/doc/d' }),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});
it('accepts ignored compatibility flags but rejects legacy document flags', async () => {
    expect(
        await get('fetch').preview({
            doc: 'd',
            'api-version': 'v1',
            format: 'csv',
            json: true,
        }),
    ).toMatchObject({ body: { format: 'xml' } });
    await expect(
        get('fetch').preview({ doc: 'd', offset: '' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(
        get('update').preview({
            doc: 'd',
            command: 'append',
            content: 'x',
            mode: '',
        }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});

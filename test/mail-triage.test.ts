import { describe, expect, it, vi } from 'vitest';
import { triagePlan, triageProgram } from '../src/capabilities/mail/triage';
type Data = Record<string, any>;
async function run(args: Data, responses: Data[]) {
    const request = vi.fn();
    responses.forEach((r) => request.mockResolvedValueOnce(r));
    let state: Data = { args, phase: 'start' };
    for (let i = 0; i < 80; i++) {
        const before = request.mock.calls.length;
        const r = await triageProgram().step(state, {
            selection: { identity: 'user' },
            grant: {},
            lark: { request },
        } as never);
        expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
        if (r.done) return { request, output: r.output as Data };
        state = r.state;
    }
    throw new Error('Unfinished');
}
describe('Mail triage', () => {
    it('lists IDs then fetches ordered metadata and returns prefixed pagination', async () => {
        const { output, request } = await run({ max: 2 }, [
            { items: ['one', 'two'], has_more: true, page_token: 'next' },
            {
                messages: [
                    {
                        message_id: 'two',
                        subject: 'Second',
                        head_from: {
                            name: 'Alice',
                            address: 'alice@example.com',
                        },
                    },
                ],
            },
        ]);
        expect(request.mock.calls[0]![0].query).toEqual({
            page_size: 2,
            folder_id: 'INBOX',
        });
        expect(output).toMatchObject({
            count: 2,
            page_token: 'list:next',
            messages: [
                {
                    message_id: 'one',
                    error: 'metadata not returned by batch_get',
                },
                {
                    message_id: 'two',
                    subject: 'Second',
                    from: 'Alice <alice@example.com>',
                    mailbox_id: 'me',
                },
            ],
        });
    });
    it('uses search pages of 15 and preserves decoded snippets and labels', async () => {
        const { output, request } = await run(
            { query: 'report', labels: true, max: 1 },
            [
                {
                    items: [
                        {
                            meta_data: {
                                message_biz_id: 'm',
                                title: 'Title',
                                body_plain_text: 'aGVsbG8',
                            },
                        },
                    ],
                    has_more: false,
                },
                { messages: [{ message_id: 'm', label_ids: ['FLAGGED'] }] },
            ],
        );
        expect(request.mock.calls[0]![0]).toMatchObject({
            method: 'POST',
            path: '/open-apis/mail/v1/user_mailboxes/me/search',
            query: { page_size: 1 },
            body: { query: 'report' },
        });
        expect(output.messages[0]).toMatchObject({
            body_plain_text: 'hello',
            labels: 'FLAGGED',
        });
    });
    it('resolves custom folder names before listing', async () => {
        const { request } = await run({ folder: 'Reports' }, [
            { items: [{ id: 'custom', name: 'Reports' }] },
            { items: [] },
        ]);
        expect(request.mock.calls[1]![0].query.folder_id).toBe('custom');
    });
    it('maps important labels to search folder priority', () => {
        expect(triagePlan({ filter: { label: 'important' } })).toMatchObject({
            search: true,
            resolved: { folder: 'priority' },
        });
    });
    it('rejects unsupported read filters, unknown fields and incompatible page tokens', () => {
        for (const args of [
            { filter: { is_unread: false } },
            { filter: { is_read: true } },
            { filter: { unknown: true } },
            { 'page-token': 'bare' },
            { 'page-token': 'list:next', query: 'search' },
        ])
            expect(() => triagePlan(args)).toThrow();
    });
});

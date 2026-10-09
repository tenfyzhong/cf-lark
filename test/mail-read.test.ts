import { describe, expect, it, vi } from 'vitest';
import {
    readPlan,
    readProgram,
    messageOutput,
} from '../src/capabilities/mail/read';
type Data = Record<string, any>;
const encode = (value: string) => Buffer.from(value).toString('base64url');
async function run(action: string, args: Data, replies: Data[]) {
    const request = vi.fn();
    replies.forEach((reply) => request.mockResolvedValueOnce(reply));
    let state: Data = { action, args, phase: 'start' };
    for (let i = 0; i < 20; i++) {
        const count = request.mock.calls.length;
        const result = await readProgram().step(state, {
            selection: { identity: 'user' },
            grant: {},
            lark: { request },
        } as never);
        expect(request.mock.calls.length - count).toBeLessThanOrEqual(1);
        if (result.done) return { output: result.output as Data, request };
        state = result.state;
    }
    throw new Error('Unfinished');
}
describe('Mail message reading', () => {
    it('decodes bodies, preserves metadata and suppresses raw body fields and attachment secrets', () => {
        const result = messageOutput(
            {
                message_id: 'id',
                folder_id: 'DRAFT',
                message_state: 3,
                body_plain_text: encode('\x1b[31mHello\rworld'),
                body_html: encode('<b>Hello</b>'),
                body_unknown: 'secret',
                label_ids: ['HIGH_PRIORITY'],
                attachments: [
                    {
                        id: 'a',
                        filename: 'x.png',
                        download_url: 'private',
                        is_inline: true,
                    },
                ],
            },
            false,
        );
        expect(result).toMatchObject({
            draft_id: 'id',
            body_plain_text: 'Helloworld',
            message_state_text: 'draft',
            priority_type: '1',
            attachments: [
                { id: 'a', content_type: 'image/png', is_inline: true },
            ],
        });
        expect(result).not.toHaveProperty('body_html');
        expect(result).not.toHaveProperty('body_unknown');
        expect(result.attachments[0]).not.toHaveProperty('download_url');
    });
    it('decodes folded calendar events with timezone and quoted parameters', () => {
        const result = messageOutput(
            {
                body_calendar: encode(
                    'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:event\r\nSUMMARY:First\\,\r\n second\r\nDTSTART;TZID=Asia/Shanghai:20260420T140000\r\nORGANIZER;CN="Doe: Jane":MAILTO:jane@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR',
                ),
            },
            true,
        );
        expect(result.calendar_event).toMatchObject({
            uid: 'event',
            summary: 'First,second',
            start: '2026-04-20T06:00:00Z',
            organizer: 'jane@example.com',
        });
    });
    it('chunks batch reads, preserves requested order and reports unavailable IDs', async () => {
        const ids = Array.from({ length: 21 }, (_, i) =>
            encode(`message-${i}`),
        );
        const { output, request } = await run(
            'messages',
            { 'message-ids': ids },
            [
                {
                    messages: ids
                        .slice(0, 19)
                        .reverse()
                        .map((message_id) => ({ message_id })),
                },
                { messages: [{ message_id: ids[20] }] },
            ],
        );
        expect(request.mock.calls[0]![0].body.message_ids).toHaveLength(20);
        expect(output.messages.map((item: Data) => item.message_id)).toEqual([
            ...ids.slice(0, 19),
            ids[20],
        ]);
        expect(output.unavailable_message_ids).toEqual([ids[19]]);
    });
    it('sorts legacy thread items chronologically and passes spam flag', async () => {
        const { output, request } = await run(
            'thread',
            { 'thread-id': 'thread', html: false, 'include-spam-trash': true },
            [
                {
                    items: [
                        { message: { message_id: 'b', internal_date: '2000' } },
                        { message: { message_id: 'a', internal_date: '1000' } },
                    ],
                },
            ],
        );
        expect(output.messages.map((item: Data) => item.message_id)).toEqual([
            'a',
            'b',
        ]);
        expect(request.mock.calls[0]![0].query).toEqual({
            format: 'plain_text_full',
            include_spam_trash: true,
        });
    });
    it('rejects duplicate and invalid batch identifiers before reading', () => {
        expect(() =>
            readPlan('messages', { 'message-ids': ['aWQ', 'aWQ'] }),
        ).toThrow();
        expect(() => readPlan('messages', { 'message-ids': '1234' })).toThrow();
    });
});

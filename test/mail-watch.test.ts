import { describe, expect, it, vi } from 'vitest';
import { watchPlan, watchProgram } from '../src/capabilities/mail/watch';
type Data = Record<string, any>;
const type = 'mail.user_mailbox.event.message_received_v1';
async function run(args: Data, responses: Data[], events: Data[]) {
    const request = vi.fn();
    responses.forEach((r) => request.mockResolvedValueOnce(r));
    const inbox = { read: vi.fn().mockResolvedValue({ events, cursor: 9 }) };
    let state: Data = { args, phase: 'start' };
    for (let i = 0; i < 30; i++) {
        const count = request.mock.calls.length;
        const result = await watchProgram(inbox as never).step(state, {
            selection: { profileId: 'p', identity: 'user' },
            grant: {},
            lark: { request },
        } as never);
        expect(request.mock.calls.length - count).toBeLessThanOrEqual(1);
        if (result.done)
            return { output: result.output as Data, request, inbox };
        state = result.state;
    }
    throw new Error('Unfinished');
}
describe('Mail callback watch', () => {
    it('subscribes once, filters mailbox events and returns a resumable cursor', async () => {
        const { output, request, inbox } = await run(
            { mailbox: 'a@example.com', 'msg-format': 'minimal' },
            [
                { primary_email_address: 'a@example.com' },
                {},
                {
                    message: {
                        message_id: 'm',
                        subject: 'hidden',
                        folder_id: 'INBOX',
                    },
                },
            ],
            [
                {
                    type,
                    sequence: 8,
                    id: 'e',
                    payload: {
                        event: {
                            mail_address: 'a@example.com',
                            message_id: 'm',
                        },
                    },
                },
                {
                    type,
                    sequence: 9,
                    id: 'other',
                    payload: {
                        event: {
                            mail_address: 'other@example.com',
                            message_id: 'other',
                        },
                    },
                },
            ],
        );
        expect(request.mock.calls[1]![0].path).toContain('/event/subscribe');
        expect(inbox.read).toHaveBeenCalledWith('p', 0, 50);
        expect(output.cursor).toBe(9);
        expect(output.events).toHaveLength(1);
        expect(output.events[0].data.message).toEqual({
            message_id: 'm',
            folder_id: 'INBOX',
        });
    });
    it('does not subscribe again for continuation and event mode needs no fetch', async () => {
        const { request, output } = await run(
            { cursor: 4, 'msg-format': 'event' },
            [{ primary_email_address: 'a@example.com' }],
            [
                {
                    type,
                    sequence: 5,
                    id: 'e',
                    payload: {
                        event: {
                            message_id: 'm',
                            mail_address: 'a@example.com',
                        },
                    },
                },
            ],
        );
        expect(request).toHaveBeenCalledTimes(1);
        expect(output.events[0].data.event.message_id).toBe('m');
    });
    it('unsubscribes explicitly without reading events', async () => {
        const { request, inbox, output } = await run({ stop: true }, [{}], []);
        expect(request.mock.calls[0]![0].path).toContain('/event/unsubscribe');
        expect(inbox.read).not.toHaveBeenCalled();
        expect(output.stopped).toBe(true);
    });
    it('validates filters and logical output paths without IO', () => {
        expect(() => watchPlan({ 'label-ids': 'not-json' })).toThrow();
        expect(() => watchPlan({ 'output-dir': '../escape' })).toThrow();
        expect(() => watchPlan({ limit: 101 })).toThrow();
    });
});
it('verifies the mailbox on continuation and excludes other accounts from event-only output', async () => {
    const { output, request } = await run(
        { cursor: 4, 'msg-format': 'event' },
        [{ primary_email_address: 'owner@example.com' }],
        [
            {
                type,
                sequence: 5,
                id: 'other',
                payload: {
                    event: {
                        mail_address: 'other@example.com',
                        message_id: 'secret',
                    },
                },
            },
            {
                type,
                sequence: 6,
                id: 'own',
                payload: {
                    event: {
                        mail_address: 'owner@example.com',
                        message_id: 'own',
                    },
                },
            },
        ],
    );
    expect(output.events).toHaveLength(1);
    expect(output.events[0].data.event.message_id).toBe('own');
    expect(request.mock.calls[0]![0].path).toContain('/profile');
});

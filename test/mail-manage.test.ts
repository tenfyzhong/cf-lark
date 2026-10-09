import { describe, expect, it, vi } from 'vitest';
import {
    mailCapabilities,
    mailPrograms,
} from '../src/capabilities/mail/commands';
import type { CommandContext } from '../src/ports/capabilities';
import { ServiceError } from '../src/domain/errors';
type Data = Record<string, any>;
const context = {
    selection: { profileId: 'p', accountId: 'a', identity: 'user' },
    grant: {},
} as unknown as CommandContext;
async function run(action: string, args: Data, responses: (Data | Error)[]) {
    const request = vi.fn();
    responses.forEach((value) =>
        value instanceof Error
            ? request.mockRejectedValueOnce(value)
            : request.mockResolvedValueOnce(value),
    );
    const program = mailPrograms().find((item) => item.id === 'mail-manage')!;
    let state: Data = { phase: 'start', action, args };
    for (let index = 0; index < 100; index++) {
        const count = request.mock.calls.length;
        const result = await program.step(state, {
            ...context,
            lark: { request },
        });
        expect(request.mock.calls.length - count).toBeLessThanOrEqual(1);
        if (result.done) return { output: result.output as Data, request };
        state = result.state;
    }
    throw new Error('Did not finish');
}
describe('Mail management shortcuts', () => {
    it('validates custom message labels and folders before chunked changes', async () => {
        const ids = Array.from(
            { length: 21 },
            (_, i) => `message_identifier_${i}`,
        );
        const { request, output } = await run(
            'message-modify',
            {
                'message-ids': ids,
                'add-label-ids': ['unread', 'custom'],
                'add-folder': 'folder',
            },
            [{}, {}, {}, {}],
        );
        expect(
            request.mock.calls.slice(0, 2).map((call) => call[0].path),
        ).toEqual([
            '/open-apis/mail/v1/user_mailboxes/me/labels/custom',
            '/open-apis/mail/v1/user_mailboxes/me/folders/folder',
        ]);
        expect(request.mock.calls[2]![0].body).toMatchObject({
            add_label_ids: ['UNREAD', 'custom'],
            add_folder: 'folder',
        });
        expect(request.mock.calls[2]![0].body.message_ids).toHaveLength(20);
        expect(output.success_message_ids).toEqual(ids);
    });
    it('retains failed batches and continues remaining thread batches', async () => {
        const ids = Array.from({ length: 21 }, (_, i) => `thread_${i}`);
        const { request, output } = await run(
            'thread-trash',
            { 'thread-ids': ids },
            [new ServiceError('UPSTREAM_ERROR', 'Denied'), {}],
        );
        expect(request).toHaveBeenCalledTimes(2);
        expect(output.success_thread_ids).toEqual(['thread_20']);
        expect(output.failed_thread_ids).toHaveLength(20);
    });
    it('does not perform a mutation for message-modify without changes', async () => {
        const { request, output } = await run(
            'message-modify',
            { 'message-ids': 'message_identifier_1' },
            [],
        );
        expect(request).not.toHaveBeenCalled();
        expect(output.success_message_ids).toEqual(['message_identifier_1']);
    });
    it('declines receipts by removing their label without sending mail', async () => {
        const { request, output } = await run(
            'decline-receipt',
            { 'message-id': 'message_identifier_1' },
            [{ message: { label_ids: ['READ_RECEIPT_REQUEST'] } }, {}],
        );
        expect(request.mock.calls[1]![0]).toMatchObject({
            method: 'PUT',
            body: { remove_label_ids: ['READ_RECEIPT_REQUEST'] },
        });
        expect(output.declined).toBe(true);
    });
    it.each([
        {
            action: 'message-trash',
            args: { 'message-ids': '1234567890123456' },
        },
        {
            action: 'message-modify',
            args: {
                'message-ids': 'message_identifier_1',
                'add-label-ids': ['unread'],
                'remove-label-ids': ['UNREAD'],
            },
        },
        {
            action: 'thread-modify',
            args: {
                'thread-ids': ['thread'],
                'add-label-ids': ['READ_RECEIPT_REQUEST'],
            },
        },
        {
            action: 'thread-modify',
            args: { 'thread-ids': ['thread'], 'add-folder': 'TRASH' },
        },
    ])(
        'rejects invalid $action before workflow start',
        async ({ action, args }) => {
            const capability = mailCapabilities({
                start: vi.fn(),
            } as never).find(
                (item) => item.definition.id === `mail.+${action}`,
            )!;
            await expect(
                capability.preview(args, context),
            ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        },
    );
    it('requires a concrete mailbox for bot identity', async () => {
        const capability = mailCapabilities({ start: vi.fn() } as never).find(
            (item) => item.definition.id === 'mail.+thread-trash',
        )!;
        await expect(
            capability.preview(
                { 'thread-ids': ['thread'] },
                { ...context, selection: { profileId: 'p', identity: 'bot' } },
            ),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});
it('recognizes the numeric receipt-request system label', async () => {
    const { output, request } = await run(
        'decline-receipt',
        { 'message-id': 'message_identifier' },
        [{ message: { label_ids: ['-607'] } }, {}],
    );
    expect(output).toMatchObject({ declined: true });
    expect(request).toHaveBeenCalledTimes(2);
});

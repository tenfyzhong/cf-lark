import { describe, expect, it, vi } from 'vitest';
import {
    deliveryPlan,
    deliveryProgram,
    signatureOutput,
} from '../src/capabilities/mail/delivery';
import { ServiceError } from '../src/domain/errors';
type Data = Record<string, any>;
async function run(action: string, args: Data, responses: (Data | Error)[]) {
    const request = vi.fn();
    responses.forEach((r) =>
        r instanceof Error
            ? request.mockRejectedValueOnce(r)
            : request.mockResolvedValueOnce(r),
    );
    let state: Data = { action, args, phase: 'start' };
    for (let i = 0; i < 30; i++) {
        const before = request.mock.calls.length;
        const r = await deliveryProgram().step(state, {
            lark: { request },
            selection: { identity: 'user' },
            grant: {},
        } as never);
        expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
        if (r.done) return { output: r.output as Data, request };
        state = r.state;
    }
    throw new Error('Unfinished');
}
describe('Mail delivery workflows', () => {
    it('creates a share token and sends using the returned card ID', async () => {
        const { output, request } = await run(
            'share-to-chat',
            { 'thread-id': 'thread', 'receive-id': 'chat' },
            [{ card_id: 'card' }, { message_id: 'message' }],
        );
        expect(request.mock.calls[1]![0]).toMatchObject({
            path: '/open-apis/mail/v1/user_mailboxes/me/share_tokens/card/send',
            query: { receive_id_type: 'chat_id' },
            body: { receive_id: 'chat' },
        });
        expect(output).toEqual({ card_id: 'card', im_message_id: 'message' });
    });
    it('keeps a draft ledger while continuing definite per-draft failures', async () => {
        const { output } = await run(
            'draft-send',
            { 'draft-id': [' first ', 'second', 'third'] },
            [
                { message_id: 'm' },
                new ServiceError('UPSTREAM_ERROR', 'Missing draft', 404),
                { message_id: 'last' },
            ],
        );
        expect(output).toMatchObject({
            total: 3,
            success_count: 2,
            failure_count: 1,
            failed: [{ draft_id: 'second' }],
            ok: false,
        });
    });
    it('stops immediately when automation sending is disabled', async () => {
        await expect(
            run('draft-send', { 'draft-id': ['first', 'second'] }, [
                { automation_send_disable: 'disabled' },
            ]),
        ).rejects.toThrow();
    });
    it('does not continue an uncertain send', async () => {
        await expect(
            run('draft-send', { 'draft-id': ['first', 'second'] }, [
                new ServiceError('OUTCOME_UNCERTAIN', 'Unknown outcome'),
            ]),
        ).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
    });
    it('rejects ambiguous sharing and duplicate draft IDs before execution', () => {
        expect(() =>
            deliveryPlan('share-to-chat', {
                'thread-id': 't',
                'message-id': 'm',
                'receive-id': 'c',
            }),
        ).toThrow();
        expect(() =>
            deliveryPlan('draft-send', { 'draft-id': ['a', ' a '] }),
        ).toThrow();
    });
    it('renders tenant signature variables and usage defaults in English', () => {
        const out = signatureOutput(
            {
                signatures: [
                    {
                        id: 's',
                        name: 'Work',
                        signature_type: 'TENANT',
                        template_json_keys: ['B-NAME'],
                        content:
                            '<span data-variable-meta-props=\'{"id":"B-NAME","type":"text"}\'>old</span><img src="x">',
                        user_fields: {
                            'B-NAME': {
                                default_val: 'Default',
                                i18n_vals: { en_us: 'Name' },
                            },
                        },
                    },
                ],
                usages: [{ send_mail_signature_id: 's' }],
            },
            's',
        );
        expect(out).toMatchObject({
            content_preview: 'Name[image]',
            is_send_default: true,
            template_vars: { 'B-NAME': 'Name' },
        });
    });
});
it('preserves pinned link attributes when rendering signature URL variables', async () => {
    const { renderSignature } = await import(
        '../src/capabilities/mail/delivery'
    );
    expect(
        renderSignature({
            template_json_keys: ['url'],
            content:
                '<span data-variable-meta-props=\'{"id":"url","type":"text"}\'>x</span>',
            user_fields: { url: { default_val: 'https://example.com' } },
        }),
    ).toBe(
        '<a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a>',
    );
});

import { describe, expect, it, vi } from 'vitest';
import { composePlan, composeProgram } from '../src/capabilities/mail/compose';
type Data = Record<string, any>;
function transformer() {
    return {
        processMail: vi.fn(async (input: Data) => {
            switch (input.operation) {
                case 'addresses':
                    return String(input.addresses || '')
                        .split(',')
                        .filter(Boolean)
                        .map((address) => ({ address: address.trim() }));
                case 'is-html':
                    return String(input.body).includes('<');
                case 'lint':
                    return {
                        cleaned_html: input.body,
                        lint_applied: [],
                        original_blocked: [],
                    };
                case 'build-eml':
                    return { raw: 'ZW1s' };
                case 'quote':
                    return { subject: 'Re: Original', quote: 'quoted' };
                case 'template-body':
                    return input.body + ' Template';
                case 'signature-body':
                    return input.body + input.signature_html;
                case 'plain-text':
                    return input.body;
                default:
                    return {};
            }
        }),
    };
}
async function run(action: string, args: Data, replies: Data[]) {
    const request = vi.fn();
    replies.forEach((r) => request.mockResolvedValueOnce(r));
    const pure = transformer();
    let state: Data = { action, args, phase: 'start' };
    for (let i = 0; i < 30; i++) {
        const count = request.mock.calls.length;
        const r = await composeProgram(undefined, pure).step(state, {
            selection: { identity: 'user' },
            grant: {},
            lark: { request },
        } as never);
        expect(request.mock.calls.length - count).toBeLessThanOrEqual(1);
        if (r.done) return { output: r.output as Data, request, pure };
        state = r.state;
    }
    throw new Error('Unfinished');
}
describe('Mail compose orchestration', () => {
    it('saves a draft by default after resolving sender profile', async () => {
        const { output, request, pure } = await run(
            'send',
            {
                to: 'bob@example.com',
                subject: 'Subject',
                body: 'Body',
                'no-signature': true,
            },
            [
                { primary_email_address: 'alice@example.com' },
                { draft_id: 'd', reference: 'preview' },
            ],
        );
        expect(request.mock.calls[0]![0].path).toContain('/profile');
        expect(request.mock.calls[1]![0]).toMatchObject({
            method: 'POST',
            body: { raw: 'ZW1s' },
        });
        expect(output.draft_id).toBe('d');
        expect(pure.processMail).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: 'build-eml',
                from: { address: 'alice@example.com' },
                to: [{ address: 'bob@example.com' }],
            }),
        );
    });
    it('sends only after draft creation when confirmed and preserves schedule', async () => {
        const { request, output } = await run(
            'send',
            {
                from: 'alice@example.com',
                to: 'bob@example.com',
                subject: 'S',
                body: 'B',
                'no-signature': true,
                'confirm-send': true,
                'send-time': '1999999999',
            },
            [{ draft_id: 'draft' }, { message_id: 'sent' }],
        );
        expect(request.mock.calls[1]![0]).toMatchObject({
            path: '/open-apis/mail/v1/user_mailboxes/alice%40example.com/drafts/draft/send',
            body: { send_time: '1999999999' },
        });
        expect(output.message_id).toBe('sent');
    });
    it('replies to original reply-to and preserves threading', async () => {
        const { pure } = await run(
            'reply',
            {
                from: 'self@example.com',
                'message-id': 'source',
                body: 'Reply',
                'no-signature': true,
            },
            [
                {
                    message: {
                        subject: 'Original',
                        head_from: { address: 'sender@example.com' },
                        reply_to: [{ address: 'reply@example.com' }],
                        smtp_message_id: '<smtp>',
                        body_plain_text: 'b3JpZ2luYWw=',
                    },
                },
                { draft_id: 'reply' },
            ],
        );
        expect(pure.processMail).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: 'build-eml',
                to: [{ address: 'reply@example.com' }],
                in_reply_to: 'smtp',
                lms_reply_to: 'source',
            }),
        );
    });
    it('refuses a receipt for an email without a receipt request', async () => {
        await expect(
            run(
                'send-receipt',
                { 'message-id': 'source', from: 'self@example.com' },
                [{ message: { subject: 'Original', label_ids: [] } }],
            ),
        ).rejects.toThrow();
    });
    it('validates incompatible flags before any network call', () => {
        for (const args of [
            { to: 'a@example.com', subject: 'S', body: 'B', 'body-file': 'f' },
            {
                to: 'a@example.com',
                subject: 'S',
                body: 'B',
                'no-signature': true,
                'signature-id': 'sig',
            },
            {
                to: 'a@example.com',
                subject: 'S',
                body: 'B',
                priority: 'urgent',
            },
        ])
            expect(() => composePlan('send', args)).toThrow();
    });
});
it('uploads oversized attachments as streamed large files before drafting', async () => {
    const size = 30 * 1024 * 1024,
        request = vi
            .fn()
            .mockResolvedValueOnce({ open_id: 'ou' })
            .mockResolvedValueOnce({
                upload_id: 'u',
                block_size: 15 * 1024 * 1024,
                block_num: 2,
            })
            .mockResolvedValueOnce({ file_token: 'token' })
            .mockResolvedValueOnce({ draft_id: 'draft' }),
        uploadStream = vi.fn().mockResolvedValue({});
    const artifacts = {
        stat: vi.fn().mockResolvedValue({ size }),
        read: vi
            .fn()
            .mockImplementation((_owner, _id, range) =>
                Promise.resolve(new Response(new Uint8Array(range.length))),
            ),
    };
    const pure = transformer();
    const implementation = pure.processMail.getMockImplementation()!;
    pure.processMail.mockImplementation(async (input) =>
        input.operation === 'large-attachments'
            ? {
                  text: 'Large file token',
                  html: 'Large file token',
                  header: 'ids',
              }
            : implementation(input),
    );
    const context = {
        selection: { identity: 'user', profileId: 'p', accountId: 'a' },
        grant: {
            id: 'g',
            revoked: false,
            expiresAt: Date.now() + 600000,
            domains: ['mail', 'artifact'],
            permissions: ['read', 'write'],
            profiles: [
                { profileId: 'p', identities: ['user'], accounts: ['a'] },
            ],
        },
        lark: { request, uploadStream },
    };
    let state: Data = {
        phase: 'start',
        action: 'send',
        args: {
            from: 'a@example.com',
            to: 'b@example.com',
            subject: 'S',
            body: 'Body',
            'no-signature': true,
            attach: [{ id: 'artifact', name: 'big.zip' }],
        },
    };
    for (let i = 0; i < 30; i++) {
        const before =
            request.mock.calls.length + uploadStream.mock.calls.length;
        const result = await composeProgram(artifacts as never, pure).step(
            state,
            context as never,
        );
        expect(
            request.mock.calls.length + uploadStream.mock.calls.length - before,
        ).toBeLessThanOrEqual(1);
        if (result.done) {
            expect(result.output).toMatchObject({ draft_id: 'draft' });
            break;
        }
        state = result.state;
    }
    expect(uploadStream).toHaveBeenCalledTimes(2);
    expect(pure.processMail).toHaveBeenCalledWith(
        expect.objectContaining({
            operation: 'build-eml',
            attachments: [],
            headers: { 'X-Lms-Large-Attachment-Ids': 'ids' },
            text: expect.stringContaining('Large file token'),
        }),
    );
});
it('forwards a source attachment through a private artifact without exposing download URLs', async () => {
    const request = vi
            .fn()
            .mockResolvedValueOnce({
                message: {
                    subject: 'Original',
                    head_from: { address: 'sender@example.com' },
                    body_plain_text: 'T3JpZ2luYWw=',
                    attachments: [
                        {
                            id: 'att',
                            filename: 'report.txt',
                            attachment_type: 1,
                        },
                    ],
                },
            })
            .mockResolvedValueOnce({
                download_urls: [
                    {
                        attachment_id: 'att',
                        download_url: 'https://files.example/att',
                    },
                ],
            })
            .mockResolvedValueOnce({ draft_id: 'draft' }),
        pure = transformer();
    const artifacts = {
            stat: vi.fn().mockResolvedValue({ size: 3 }),
            read: vi.fn().mockResolvedValue(new Response('abc')),
            ingest: vi.fn().mockResolvedValue({ id: 'private', size: 3 }),
        },
        remote = { stream: vi.fn().mockResolvedValue(new Response('abc')) };
    const context = {
        selection: { identity: 'user', profileId: 'p' },
        grant: { id: 'g' },
        lark: { request },
    };
    let state: Data = {
        phase: 'start',
        action: 'forward',
        args: {
            from: 'a@example.com',
            to: 'b@example.com',
            body: 'FYI',
            'message-id': 'm',
            'no-signature': true,
        },
    };
    for (let i = 0; i < 30; i++) {
        const result = await composeProgram(
            artifacts as never,
            pure,
            remote as never,
        ).step(state, context as never);
        if (result.done) {
            expect(result.output).toMatchObject({ draft_id: 'draft' });
            break;
        }
        state = result.state;
    }
    expect(remote.stream).toHaveBeenCalled();
    expect(pure.processMail).toHaveBeenCalledWith(
        expect.objectContaining({
            operation: 'build-eml',
            attachments: [{ name: 'report.txt', data: 'YWJj' }],
        }),
    );
});
it('appends template recipients even with an explicit recipient and merges the authored body', async () => {
    const { pure } = await run(
        'send',
        {
            from: 'a@example.com',
            to: 'b@example.com',
            subject: 'User',
            body: 'Body',
            'template-id': '1',
            'no-signature': true,
        },
        [
            {
                template: {
                    tos: [{ mail_address: 'template@example.com' }],
                    template_content: 'Template',
                },
            },
            { draft_id: 'd' },
        ],
    );
    expect(pure.processMail).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'template-body', body: 'Body' }),
    );
    expect(pure.processMail).toHaveBeenCalledWith(
        expect.objectContaining({
            operation: 'build-eml',
            to: [
                { address: 'b@example.com' },
                { address: 'template@example.com' },
            ],
        }),
    );
});
it('embeds authored local artifact image references with generated CIDs', async () => {
    const request = vi.fn().mockResolvedValue({ draft_id: 'd' }),
        artifacts = {
            stat: vi.fn().mockResolvedValue({ size: 3 }),
            read: vi
                .fn()
                .mockImplementation(() => Promise.resolve(new Response('abc'))),
        },
        pure = transformer(),
        context = {
            selection: { identity: 'user', profileId: 'p', accountId: 'a' },
            grant: {
                id: 'g',
                revoked: false,
                expiresAt: Date.now() + 600000,
                domains: ['mail', 'artifact'],
                permissions: ['read', 'write'],
                profiles: [
                    { profileId: 'p', identities: ['user'], accounts: ['a'] },
                ],
            },
            lark: { request },
        };
    let state: Data = {
        phase: 'start',
        action: 'send',
        args: {
            from: 'a@example.com',
            to: 'b@example.com',
            subject: 'S',
            body: '<img src="@photo.png">',
            'no-signature': true,
        },
    };
    for (let i = 0; i < 12; i++) {
        const result = await composeProgram(artifacts as never, pure).step(
            state,
            context as never,
        );
        if (result.done) break;
        state = result.state;
    }
    expect(pure.processMail).toHaveBeenCalledWith(
        expect.objectContaining({
            operation: 'build-eml',
            html: expect.stringContaining('cid:mail-artifact-'),
            inline: [
                expect.objectContaining({ name: 'photo.png', data: 'YWJj' }),
            ],
        }),
    );
});
it('sends embedded attachment drafts with streamed authenticated JSON', async () => {
    const request = vi.fn(),
        requestStream = vi.fn().mockResolvedValue({ draft_id: 'd' }),
        artifacts = {
            stat: vi.fn().mockResolvedValue({ size: 3 }),
            read: vi.fn(async () => new Response('abc')),
        },
        pure = transformer(),
        implementation = pure.processMail.getMockImplementation()!;
    pure.processMail.mockImplementation(async (input: Data) =>
        input.operation === 'build-eml'
            ? {
                  raw: btoa(
                      input.attachments
                          .map((v: Data) => v.data + '\n\n')
                          .join(''),
                  ),
              }
            : implementation(input),
    );
    const context = {
        selection: { identity: 'user', profileId: 'p', accountId: 'a' },
        grant: {
            id: 'g',
            revoked: false,
            expiresAt: Date.now() + 600000,
            domains: ['mail', 'artifact'],
            permissions: ['read', 'write'],
            profiles: [
                { profileId: 'p', identities: ['user'], accounts: ['a'] },
            ],
        },
        lark: { request, requestStream },
    };
    let state: Data = {
        phase: 'start',
        action: 'send',
        args: {
            from: 'a@example.com',
            to: 'b@example.com',
            subject: 'S',
            body: 'B',
            'no-signature': true,
            attach: [{ id: 'file', name: 'f.txt' }],
        },
    };
    for (let i = 0; i < 12; i++) {
        const result = await composeProgram(artifacts as never, pure).step(
            state,
            context as never,
        );
        if (result.done) break;
        state = result.state;
    }
    expect(request).not.toHaveBeenCalled();
    expect(requestStream.mock.calls[0]![0]).toMatchObject({
        method: 'POST',
        path: expect.stringContaining('/drafts'),
        body: expect.any(ReadableStream),
    });
    const json = JSON.parse(
        await new Response(requestStream.mock.calls[0]![0].body).text(),
    );
    expect(atob(json.raw)).toContain('YWJj');
});
it('sends a native read receipt without downloading original inline attachments', async () => {
    const request = vi
            .fn()
            .mockResolvedValueOnce({
                message: {
                    subject: 'Original',
                    head_from: { address: 'sender@example.com' },
                    label_ids: ['-607'],
                    attachments: [{ id: 'a', is_inline: true, cid: 'image' }],
                },
            })
            .mockResolvedValueOnce({ draft_id: 'd' })
            .mockResolvedValueOnce({ message_id: 'sent' }),
        pure = transformer(),
        implementation = pure.processMail.getMockImplementation()!;
    pure.processMail.mockImplementation(async (input) =>
        input.operation === 'receipt'
            ? {
                  subject: 'Read receipt: Original',
                  text: 'Read receipt body',
                  html: '<p>Read receipt body</p>',
              }
            : implementation(input),
    );
    let state: Data = {
        phase: 'start',
        action: 'send-receipt',
        args: { from: 'reader@example.com', 'message-id': 'm' },
    };
    for (let i = 0; i < 12; i++) {
        const result = await composeProgram(undefined, pure).step(state, {
            grant: {},
            selection: { identity: 'user' },
            lark: { request },
        } as never);
        if (result.done) {
            expect(result.output).toMatchObject({
                message_id: 'sent',
                receipt_for_message_id: 'm',
            });
            break;
        }
        state = result.state;
    }
    expect(pure.processMail).toHaveBeenCalledWith(
        expect.objectContaining({
            operation: 'build-eml',
            is_receipt: true,
            text: 'Read receipt body',
            html: '<p>Read receipt body</p>',
        }),
    );
    expect(request).toHaveBeenCalledTimes(3);
});
it('counts retained source attachments before classifying new regular attachments', async () => {
    const artifacts = {
            stat: vi.fn(async (_owner, id) => ({
                size: id === 'source' ? 14 * 1024 * 1024 : 8 * 1024 * 1024,
            })),
            read: vi.fn(),
        },
        context = {
            selection: { identity: 'user', profileId: 'p', accountId: 'a' },
            grant: {
                id: 'g',
                revoked: false,
                expiresAt: Date.now() + 600000,
                domains: ['mail', 'artifact'],
                permissions: ['read', 'write'],
                profiles: [
                    { profileId: 'p', identities: ['user'], accounts: ['a'] },
                ],
            },
            lark: { request: vi.fn() },
        },
        state: Data = {
            phase: 'build',
            action: 'forward',
            args: {
                from: 'a@example.com',
                to: 'b@example.com',
                subject: 'S',
                body: 'B',
                'no-signature': true,
            },
            sender: 'a@example.com',
            mailbox: 'a@example.com',
            original: {},
            template: {},
            signatures: {},
            files: [{ id: 'new', name: 'new.txt' }],
            inline: [],
            resourcesComplete: true,
            resourceFiles: [
                { id: 'source', name: 'source.txt', internal: true },
            ],
        };
    const result = await composeProgram(artifacts as never, transformer()).step(
        state,
        context as never,
    );
    expect(result).toMatchObject({
        done: false,
        state: { phase: 'upload-owner', largeFiles: [{ id: 'new' }] },
    });
    expect(artifacts.read).not.toHaveBeenCalled();
});

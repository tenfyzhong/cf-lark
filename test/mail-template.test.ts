import { expect, it, vi } from 'vitest';
import {
    templatePlan,
    templateProgram,
} from '../src/capabilities/mail/templates';
import type { CommandContext } from '../src/ports/capabilities';
const pure = {
    processMail: vi.fn(async (input: any) =>
        input.operation === 'addresses'
            ? String(input.addresses).trim()
                ? [{ address: String(input.addresses), name: '' }]
                : []
            : /<[^>]+>/.test(input.body),
    ),
};
const context = (request: any) =>
    ({ lark: { request }, selection: { identity: 'user' } }) as CommandContext;
it('validates template identifiers, names and mutually exclusive content flags', () => {
    expect(() =>
        templatePlan('template-create', { name: 'x'.repeat(101) }),
    ).toThrow('100');
    expect(() =>
        templatePlan('template-update', { 'template-id': 'abc' }),
    ).toThrow('decimal');
    expect(() =>
        templatePlan('template-create', {
            name: 'x',
            'template-content': 'text',
            'template-content-file': 'artifact',
        }),
    ).toThrow('mutually');
});
it('prints a patch skeleton without fetching or requiring a template ID', async () => {
    const request = vi.fn();
    const result = await templateProgram(undefined, pure).step(
        {
            action: 'template-update',
            phase: 'start',
            args: { 'print-patch-template': true },
        },
        context(request),
    );
    expect(result).toMatchObject({
        done: true,
        output: {
            template_content: expect.any(String),
            is_plain_text_mode: 'bool (optional)',
        },
    });
    expect(request).not.toHaveBeenCalled();
});
it('creates a template with HTML linebreaks even in plain-text mode', async () => {
    const request = vi
            .fn()
            .mockResolvedValue({ template: { template_id: '1' } }),
        program = templateProgram(undefined, pure),
        ctx = context(request);
    let result: any = await program.step(
        {
            action: 'template-create',
            phase: 'start',
            args: {
                name: 'Example',
                'template-content': 'One\nTwo',
                'plain-text': true,
                to: ['a@example.com'],
            },
        },
        ctx,
    );
    while (!result.done) result = await program.step(result.state, ctx);
    expect(request.mock.calls[0]![0]).toMatchObject({
        method: 'POST',
        path: '/open-apis/mail/v1/user_mailboxes/me/templates',
        body: {
            template: {
                name: 'Example',
                template_content: expect.stringContaining('One<br>Two'),
                is_plain_text_mode: true,
                tos: [{ mail_address: 'a@example.com' }],
            },
        },
    });
});
it('clears recipients and prunes orphaned inline attachments on content replacement', async () => {
    const request = vi
        .fn()
        .mockResolvedValueOnce({
            template: {
                template_id: '12',
                name: 'Existing',
                subject: 'Keep',
                template_content: '<img src="cid:old">',
                tos: [{ mail_address: 'old@example.com' }],
                attachments: [
                    { id: 'old-key', cid: 'old', is_inline: true },
                    { id: 'document', is_inline: false },
                ],
            },
        })
        .mockResolvedValue({ template: { template_id: '12' } });
    const program = templateProgram(undefined, pure),
        ctx = context(request);
    let result: any = await program.step(
        {
            action: 'template-update',
            phase: 'start',
            args: {
                'template-id': '12',
                'set-to': '',
                'set-template-content': '<p>New</p>',
            },
        },
        ctx,
    );
    while (!result.done) result = await program.step(result.state, ctx);
    expect(request.mock.calls[1]![0]).toMatchObject({
        method: 'PUT',
        body: {
            template: {
                subject: 'Keep',
                attachments: [
                    { id: 'document', body: 'document', is_inline: false },
                ],
            },
        },
    });
    expect(request.mock.calls[1]![0].body.template.tos ?? []).toEqual([]);
});
it('accepts unwrapped template responses and does not rewrap unchanged content', async () => {
    const request = vi
        .fn()
        .mockResolvedValueOnce({
            template_id: '12',
            name: 'Keep',
            template_content: 'Legacy plain body',
            is_plain_text_mode: false,
        })
        .mockResolvedValue({ template_id: '12', name: 'Changed' });
    const program = templateProgram(undefined, pure),
        ctx = context(request);
    let result: any = await program.step(
        {
            action: 'template-update',
            phase: 'start',
            args: { 'template-id': '12', 'set-name': 'Changed' },
        },
        ctx,
    );
    while (!result.done) result = await program.step(result.state, ctx);
    expect(request.mock.calls[1]![0].body.template.template_content).toBe(
        'Legacy plain body',
    );
    expect(result.output.template.name).toBe('Changed');
});
it('deduplicates uploaded attachment keys while retaining the fetched attachment body', async () => {
    const uploadStream = vi.fn().mockResolvedValue({ file_token: 'same-key' });
    const request = vi
        .fn()
        .mockResolvedValue({ template: { template_id: '12' } });
    const artifacts = {
        stat: vi.fn(),
        read: vi.fn().mockResolvedValue(new Response('x')),
        upload: vi.fn(),
        remove: vi.fn(),
    };
    const ctx = {
        ...context(request),
        lark: { request, uploadStream },
        selection: { profileId: 'p', accountId: 'a', identity: 'user' },
        grant: {
            id: 'g',
            revoked: false,
            expiresAt: Date.now() + 60000,
            profiles: [
                { profileId: 'p', identities: ['user'], accounts: ['a'] },
            ],
            domains: ['mail', 'artifact'],
            permissions: ['read', 'write'],
        },
    } as CommandContext;
    const program = templateProgram(artifacts, pure);
    const result: any = await program.step(
        {
            action: 'template-update',
            args: { 'template-id': '12' },
            phase: 'upload',
            mailbox: 'me',
            updating: true,
            template: {
                template_id: '12',
                name: 'Keep',
                template_content: '',
                attachments: [
                    { id: 'same-key', body: 'same-key', is_inline: false },
                ],
            },
            uploads: [{ id: 'artifact', name: 'report.pdf', is_inline: false }],
            offset: 0,
            projected: 2000,
            rawSmall: 0,
            largeBucket: false,
            upload: {
                phase: 'prepare',
                file: { id: 'artifact', name: 'report.pdf', size: 1 },
                openId: 'ou',
            },
        },
        ctx,
    );
    expect(result.state.template.attachments).toHaveLength(1);
});
it('applies an artifact patch after flat flags and allows explicit empty body and subject', async () => {
    const patch = JSON.stringify({
        subject: '',
        template_content: '',
        is_plain_text_mode: false,
        tos: [],
    });
    const artifacts = {
        stat: vi
            .fn()
            .mockResolvedValue({
                size: new TextEncoder().encode(patch).length,
            }),
        read: vi.fn().mockResolvedValue(new Response(patch)),
        upload: vi.fn(),
        remove: vi.fn(),
    };
    const request = vi
        .fn()
        .mockResolvedValue({ template: { template_id: '12' } });
    const ctx = {
        ...context(request),
        selection: { profileId: 'p', accountId: 'a', identity: 'user' },
        grant: {
            id: 'g',
            revoked: false,
            expiresAt: Date.now() + 60000,
            profiles: [
                { profileId: 'p', identities: ['user'], accounts: ['a'] },
            ],
            domains: ['mail', 'artifact'],
            permissions: ['read', 'write'],
        },
    } as CommandContext;
    const program = templateProgram(artifacts, pure);
    const result: any = await program.step(
        {
            action: 'template-update',
            args: {
                'template-id': '12',
                'set-subject': 'Flat',
                'patch-file': 'patch',
            },
            phase: 'prepare',
            mailbox: 'me',
            updating: true,
            template: {
                template_id: '12',
                name: 'Keep',
                subject: 'Old',
                template_content: 'Old',
                attachments: [],
            },
            files: [],
            inline: [],
        },
        ctx,
    );
    expect(result.state.template).toMatchObject({
        subject: '',
        template_content: '',
        is_plain_text_mode: false,
        tos: [],
    });
});
it('rejects unmatched inline CIDs before any upload', async () => {
    const request = vi.fn(),
        program = templateProgram(undefined, pure);
    await expect(
        program.step(
            {
                action: 'template-create',
                args: {
                    name: 'Bad',
                    'template-content': '<img src="cid:missing">',
                },
                phase: 'prepare',
                template: { name: 'Bad' },
                files: [],
                inline: [],
                updating: false,
            },
            context(request),
        ),
    ).rejects.toThrow('without a matching');
    expect(request).not.toHaveBeenCalled();
});
it('preserves legacy inline references when an update only adds a normal attachment', async () => {
    const request = vi
        .fn()
        .mockResolvedValue({ template: { template_id: '12' } });
    await expect(
        templateProgram(undefined, pure).step(
            {
                action: 'template-update',
                args: { 'template-id': '12' },
                phase: 'write',
                mailbox: 'me',
                updating: true,
                uploads: [{ id: 'normal' }],
                template: {
                    template_id: '12',
                    name: 'Legacy',
                    template_content: '',
                    attachments: [
                        {
                            id: 'old',
                            cid: 'orphan',
                            is_inline: true,
                            body: 'old',
                        },
                    ],
                },
            },
            context(request),
        ),
    ).resolves.toMatchObject({ done: true });
});
it('registers both template shortcuts with artifact-aware attachment inputs', async () => {
    const { mailCapabilities, mailPrograms } = await import(
        '../src/capabilities/mail/commands'
    );
    const capabilities = mailCapabilities({ start: vi.fn() } as never);
    for (const action of ['template-create', 'template-update'])
        expect(
            capabilities.some((c) => c.definition.id === `mail.+${action}`),
        ).toBe(true);
    expect(mailPrograms().some((p) => p.id === 'mail-template')).toBe(true);
});

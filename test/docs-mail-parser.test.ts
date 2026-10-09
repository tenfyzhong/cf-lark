import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { WasmDocumentParser } from '../src/infrastructure/documents/engine';
describe('Exact pinned mail transformations', () => {
    it('removes dangerous HTML and applies native mail style transformations', async () => {
        const module = await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/mail/parser.wasm',
                    import.meta.url,
                ),
            ),
        );
        const parser = new WasmDocumentParser(module);
        const result = (await parser.processMail({
            operation: 'lint',
            body: '<font color="red">Hello</font><script>alert(1)</script><a href="javascript:evil()">link</a>',
        })) as Record<string, any>;
        expect(result.cleaned_html).not.toContain('<script');
        expect(result.cleaned_html).not.toContain('javascript:');
        expect(result.cleaned_html).not.toContain('<font');
        expect(
            result.lint_applied.map((x: Record<string, any>) => x.rule_id),
        ).toContain('TAG_FONT_TO_SPAN');
        expect(
            result.original_blocked.map((x: Record<string, any>) => x.rule_id),
        ).toContain('TAG_SCRIPT_BLOCKED');
    });
    it('preserves plain text without parsing it as HTML', async () => {
        const module = await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/mail/parser.wasm',
                    import.meta.url,
                ),
            ),
        );
        const result = (await new WasmDocumentParser(module).processMail({
            operation: 'lint',
            body: 'Plain text',
        })) as Record<string, any>;
        expect(result).toMatchObject({
            cleaned_html: 'Plain text',
            lint_applied: [],
            original_blocked: [],
        });
    });
});
describe('Pinned mail MIME builder and editor', () => {
    it('builds, projects and patches a MIME draft without losing its attachment', async () => {
        const module = await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/mail/parser.wasm',
                    import.meta.url,
                ),
            ),
        );
        const parser = new WasmDocumentParser(module);
        const built = (await parser.processMail({
            operation: 'build-eml',
            from: { address: 'alice@example.com' },
            to: [{ address: 'bob@example.com' }],
            subject: 'Original',
            text: 'Hello',
            attachments: [
                {
                    name: 'report.txt',
                    content_type: 'text/plain',
                    data: 'cmVwb3J0',
                },
            ],
        })) as Record<string, any>;
        const changed = (await parser.processMail({
            operation: 'edit-eml',
            raw: built.raw,
            patch: { ops: [{ op: 'set_subject', value: 'Updated' }] },
        })) as Record<string, any>;
        expect(changed.projection.subject).toBe('Updated');
        expect(changed.projection.attachments_summary).toHaveLength(1);
        expect(changed.projection.attachments_summary[0].filename).toBe(
            'report.txt',
        );
    });
    it('rejects header injection and executable attachments', async () => {
        const module = await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/mail/parser.wasm',
                    import.meta.url,
                ),
            ),
        );
        const parser = new WasmDocumentParser(module);
        await expect(
            parser.processMail({
                operation: 'build-eml',
                from: { address: 'alice@example.com' },
                to: [{ address: 'bob@example.com' }],
                subject: 'Hello\r\nBcc: attacker@example.com',
                text: 'Hello',
            }),
        ).rejects.toThrow();
        await expect(
            parser.processMail({
                operation: 'build-eml',
                from: { address: 'alice@example.com' },
                to: [{ address: 'bob@example.com' }],
                subject: 'Hello',
                text: 'Hello',
                attachments: [{ name: 'run.exe', data: 'YQ==' }],
            }),
        ).rejects.toThrow();
    });
});
describe('Pinned reply quote generation', () => {
    it('deduplicates reply prefixes and creates native quote markup', async () => {
        const module = await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/mail/parser.wasm',
                    import.meta.url,
                ),
            ),
        );
        const parser = new WasmDocumentParser(module);
        const result = (await parser.processMail({
            operation: 'quote',
            use_html: true,
            original: {
                subject: 'Re: Re: Report',
                from: { address: 'a@example.com', name: 'Alice' },
                body: '<p>Original</p>',
            },
        })) as Record<string, any>;
        expect(result.subject).toBe('Re: Report');
        expect(result.quote).toContain('adit-html-block--collapsed');
        expect(result.quote).toContain('Original');
    });
});
it('renders pinned large-attachment cards and receipt messages', async () => {
    const module = await WebAssembly.compile(
        await readFile(
            new URL(
                '../src/infrastructure/documents/generated/mail/parser.wasm',
                import.meta.url,
            ),
        ),
    );
    const parser = new WasmDocumentParser(module);
    const large = (await parser.processMail({
        operation: 'large-attachments',
        brand: 'lark',
        large: [{ name: 'report <1>.pdf', size: 2048, token: 'a b' }],
        body: '<p>Body</p>',
        use_html: true,
    })) as any;
    expect(large.html).toContain('large-file-area-');
    expect(large.html).toContain('report &lt;1&gt;.pdf');
    expect(large.html).toContain(
        'www.larksuite.com/mail/page/attachment?token=a+b',
    );
    expect(JSON.parse(atob(large.header))).toEqual([{ id: 'a b' }]);
    const receipt = (await parser.processMail({
        operation: 'receipt',
        subject: 'Read receipt: Read receipt: Report',
        from: { address: 'reader@example.com' },
        original_millis: 0,
        read_time: '2026-10-09T00:00:00Z',
    })) as any;
    expect(receipt.subject).toBe('Read receipt: Report');
    expect(receipt.text).toContain('Your message has been read. Details:');
    expect(receipt.text).toContain('> Sent: -');
    expect(receipt.html).toContain('reader@example.com');
});
it('merges template content and positions signature before the quote', async () => {
    const module = await WebAssembly.compile(
        await readFile(
            new URL(
                '../src/infrastructure/documents/generated/mail/parser.wasm',
                import.meta.url,
            ),
        ),
    );
    const parser = new WasmDocumentParser(module);
    expect(
        await parser.processMail({
            operation: 'template-body',
            action: 'send',
            body: 'User',
            template: {
                template_content: 'Template',
                is_plain_text_mode: true,
            },
        }),
    ).toBe('User\n\nTemplate');
    const quote = (await parser.processMail({
        operation: 'quote',
        use_html: true,
        original: {
            subject: 'S',
            from: { address: 'a@example.com' },
            body: '<p>Quoted content</p>',
        },
    })) as any;
    const html = (await parser.processMail({
        operation: 'signature-body',
        body: '<p>User</p>' + quote.quote,
        signature_id: 'sig',
        signature_html: 'Signature',
    })) as string;
    expect(html.indexOf('Signature')).toBeLessThan(
        html.indexOf('Quoted content'),
    );
});
it('adds uploaded large-file references while editing a draft', async () => {
    const module = await WebAssembly.compile(
        await readFile(
            new URL(
                '../src/infrastructure/documents/generated/mail/parser.wasm',
                import.meta.url,
            ),
        ),
    );
    const parser = new WasmDocumentParser(module);
    const built = (await parser.processMail({
        operation: 'build-eml',
        from: { address: 'a@example.com' },
        to: [{ address: 'b@example.com' }],
        subject: 'S',
        text: 'Body',
    })) as any;
    const changed = (await parser.processMail({
        operation: 'edit-eml',
        raw: built.raw,
        patch: { ops: [] },
        large: [{ name: 'large.zip', size: 30000000, token: 'tok' }],
        brand: 'lark',
    })) as any;
    expect(changed.projection.large_attachments_summary).toEqual(
        expect.arrayContaining([expect.objectContaining({ token: 'tok' })]),
    );
    expect(changed.base_size).toBeGreaterThan(0);
});
it('builds draft calendar attendees from pending recipient edits', async () => {
    const module = await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/mail/parser.wasm',
                    import.meta.url,
                ),
            ),
        ),
        parser = new WasmDocumentParser(module),
        built = (await parser.processMail({
            operation: 'build-eml',
            from: { address: 'a@example.com' },
            to: [{ address: 'old@example.com' }],
            subject: 'S',
            text: 'Body',
        })) as any;
    const changed = (await parser.processMail({
        operation: 'edit-eml',
        raw: built.raw,
        patch: {
            ops: [
                {
                    op: 'set_recipients',
                    field: 'to',
                    addresses: [{ address: 'new@example.com' }],
                },
                {
                    op: 'set_calendar',
                    event_summary: 'Meeting',
                    event_start: '2026-10-09T10:00:00Z',
                    event_end: '2026-10-09T11:00:00Z',
                },
            ],
        },
    })) as any;
    expect(atob(changed.raw.replace(/-/g, '+').replace(/_/g, '/'))).toContain(
        'new@example.com',
    );
    expect(atob(changed.raw.replace(/-/g, '+').replace(/_/g, '/'))).toContain(
        'text/calendar',
    );
});
it('rejects measured dense HTML before parsing and keeps the engine usable', async () => {
    const module = await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/mail/parser.wasm',
                    import.meta.url,
                ),
            ),
        ),
        parser = new WasmDocumentParser(module);
    await expect(
        parser.processMail({
            operation: 'lint',
            body: '<p>x</p>'.repeat(32768),
        }),
    ).rejects.toThrow('complexity');
    const raw = btoa(
        'From: a@example.com\nTo: b@example.com\nSubject: Dense\nContent-Type: text/html\nContent-Transfer-Encoding: 7bit\n\n' +
            '<p>x</p>'.repeat(32768),
    );
    await expect(
        parser
            .processMail({ operation: 'inspect-eml', raw })
            .then(() => undefined),
    ).rejects.toThrow('complexity');
    expect(
        await parser.processMail({ operation: 'lint', body: 'Plain text' }),
    ).toMatchObject({ cleaned_html: 'Plain text' });
});

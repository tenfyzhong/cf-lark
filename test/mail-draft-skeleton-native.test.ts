import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { beforeAll, expect, it } from 'vitest';
import { WasmDocumentParser } from '../src/infrastructure/documents/engine';
let engine: WasmDocumentParser;
beforeAll(async () => {
    engine = new WasmDocumentParser(
        await WebAssembly.compile(
            await readFile(
                new URL(
                    '../src/infrastructure/documents/generated/mail/parser.wasm',
                    import.meta.url,
                ),
            ),
        ),
    );
});
const attachment = Buffer.concat([
    Buffer.alloc(512, 0x61),
    Buffer.from('private-attachment-sentinel-12345'),
]);
const folded = (bytes: Uint8Array) =>
    Buffer.from(bytes)
        .toString('base64')
        .match(/.{1,76}/gu)!
        .join('\n');
const inline = Buffer.from('private-inline-sentinel-67890');
const raw = Buffer.from(
    [
        'From: alice@example.com',
        'To: bob@example.com',
        'Subject: Original',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="outer"',
        '',
        '--outer',
        'Content-Type: multipart/related; boundary="inner"',
        '',
        '--inner',
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        '<p>Original <img src="cid:picture@example.com"/></p>',
        '--inner',
        'Content-Type: image/png; name="picture.png"',
        'Content-Disposition: inline; filename="picture.png"',
        'Content-ID: <picture@example.com>',
        'Content-Transfer-Encoding: base64',
        '',
        inline.toString('base64'),
        '--inner--',
        '--outer',
        'Content-Type: application/octet-stream; name="report.dat"',
        'Content-Disposition: attachment; filename="report.dat"',
        'Content-Transfer-Encoding: base64',
        '',
        folded(attachment),
        '--outer--',
        '',
    ].join('\r\n'),
).toString('base64url');
it('retains attachment and inline sentinels and Content-ID through native subject/body edits', async () => {
    const changed = (await engine.processMail({
        operation: 'edit-eml',
        raw,
        patch: {
            ops: [
                { op: 'set_subject', value: 'Updated' },
                {
                    op: 'set_body',
                    value: '<p>Updated <img src="cid:picture@example.com"/></p>',
                },
            ],
        },
    })) as any;
    const message = Buffer.from(changed.raw, 'base64url').toString();
    expect(changed.projection.subject).toBe('Updated');
    expect(changed.projection.inline_summary).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ cid: 'picture@example.com' }),
        ]),
    );
    expect(message).toContain(folded(attachment) + '\n');
    expect(message).toContain(inline.toString('base64') + '\n');
    expect(message).toContain('Content-ID: <picture@example.com>');
    expect(message).not.toContain('\r');
});
it('drops the removed part sentinel while retaining the other payload', async () => {
    const inspected = (await engine.processMail({
        operation: 'inspect-eml',
        raw,
    })) as any;
    const changed = (await engine.processMail({
        operation: 'edit-eml',
        raw,
        patch: {
            ops: [
                {
                    op: 'remove_attachment',
                    target: {
                        part_id:
                            inspected.projection.attachments_summary[0].part_id,
                    },
                },
            ],
        },
    })) as any;
    const message = Buffer.from(changed.raw, 'base64url').toString();
    expect(changed.projection.attachments_summary ?? []).toHaveLength(0);
    expect(message).not.toContain(folded(attachment));
    expect(message).toContain(inline.toString('base64'));
});

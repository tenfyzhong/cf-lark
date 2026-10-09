import { describe, expect, it, vi } from 'vitest';
import { draftPlan, draftProgram } from '../src/capabilities/mail/edit';
type Data = Record<string, any>;
async function run(args: Data) {
    const request = vi
        .fn()
        .mockResolvedValueOnce({ draft: { raw: 'ZW1s' } })
        .mockResolvedValueOnce({ draft_id: 'updated', reference: 'preview' });
    const processMail = vi.fn(async (input: Data) =>
        input.operation === 'addresses'
            ? [{ address: input.addresses }]
            : input.operation === 'lint'
              ? {
                    cleaned_html: input.body,
                    lint_applied: [],
                    original_blocked: [],
                }
              : input.operation === 'edit-eml'
                ? { raw: 'bmV3', projection: { subject: 'Updated' } }
                : {
                      projection: {
                          subject: 'Old',
                          to: [{ address: 'to@example.com' }],
                      },
                      from: [{ address: 'from@example.com' }],
                  },
    );
    let state: Data = { args, phase: 'start' };
    for (let i = 0; i < 20; i++) {
        const before = request.mock.calls.length;
        const result = await draftProgram(undefined, { processMail }).step(
            state,
            {
                selection: { identity: 'user' },
                grant: {},
                lark: { request },
            } as never,
        );
        expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
        if (result.done)
            return { output: result.output as Data, request, processMail };
        state = result.state;
    }
    throw new Error('Unfinished');
}
describe('Mail draft editing', () => {
    it('inspects without changing or sending the draft', async () => {
        const { request, output } = await run({
            'draft-id': 'd',
            inspect: true,
        });
        expect(request).toHaveBeenCalledTimes(1);
        expect(output).toEqual({
            draft_id: 'd',
            projection: { subject: 'Old', to: [{ address: 'to@example.com' }] },
        });
    });
    it('builds typed metadata/body/priority ops and updates only the existing draft', async () => {
        const { request, output, processMail } = await run({
            'draft-id': 'd',
            'set-subject': 'Updated',
            'set-to': 'bob@example.com',
            body: '<p>Body</p>',
            'set-priority': 'normal',
        });
        expect(request.mock.calls[1]![0]).toMatchObject({
            method: 'PUT',
            path: '/open-apis/mail/v1/user_mailboxes/me/drafts/d',
            body: { raw: 'bmV3' },
        });
        expect(processMail).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: 'edit-eml',
                patch: expect.objectContaining({
                    ops: expect.arrayContaining([
                        { op: 'set_subject', value: 'Updated' },
                        { op: 'remove_header', name: 'X-Cli-Priority' },
                    ]),
                }),
            }),
        );
        expect(output.draft_id).toBe('updated');
    });
    it('rejects missing operations and conflicting body flags before network', () => {
        expect(() => draftPlan({ 'draft-id': 'd' })).toThrow();
        expect(() =>
            draftPlan({ 'draft-id': 'd', body: 'x', 'body-file': 'f' }),
        ).toThrow();
    });
});
it('preserves a confirmed update when temporary artifact cleanup fails', async () => {
    const request = vi
            .fn()
            .mockResolvedValueOnce({ raw: 'ZW1s' })
            .mockResolvedValueOnce({ draft_id: 'd' }),
        remove = vi.fn().mockRejectedValue(Error('cleanup')),
        artifacts = {
            upload: vi.fn().mockResolvedValue({ id: 'temp' }),
            read: vi.fn().mockResolvedValue(new Response('ZW1s')),
            remove,
        };
    const pure = {
        processMail: vi.fn(async (input: Data) =>
            input.operation === 'edit-eml'
                ? { raw: 'bmV3', projection: {} }
                : { projection: {}, from: [] },
        ),
    };
    let state: Data = {
        phase: 'start',
        args: { 'draft-id': 'd', 'set-subject': 'New' },
    };
    for (let i = 0; i < 10; i++) {
        const result = await draftProgram(artifacts as never, pure).step(
            state,
            {
                grant: { id: 'g' },
                selection: { identity: 'user' },
                lark: { request },
            } as never,
        );
        if (result.done) {
            expect(result.output).toMatchObject({ draft_id: 'd' });
            return;
        }
        state = result.state;
    }
    throw Error('Not completed');
});
it('uploads oversized draft additions before applying the remaining patch', async () => {
    const patch = JSON.stringify({
            ops: [{ op: 'add_attachment', path: 'big.zip' }],
        }),
        request = vi
            .fn()
            .mockResolvedValueOnce({ raw: 'ZW1s' })
            .mockResolvedValueOnce({ open_id: 'ou' })
            .mockResolvedValueOnce({
                upload_id: 'u',
                block_size: 15 * 1024 * 1024,
                block_num: 2,
            })
            .mockResolvedValueOnce({ file_token: 'tok' })
            .mockResolvedValueOnce({ draft_id: 'd' }),
        uploadStream = vi.fn().mockResolvedValue({});
    const artifacts = {
        stat: vi.fn(async (_o, id) => ({
            size: id === 'patch' ? patch.length : 30 * 1024 * 1024,
        })),
        read: vi.fn(
            async (_o, id, range) =>
                new Response(
                    id === 'patch'
                        ? patch
                        : id === 'temp'
                          ? 'ZW1s'
                          : new Uint8Array(range?.length ?? 0),
                ),
        ),
        upload: vi.fn().mockResolvedValue({ id: 'temp' }),
        remove: vi.fn().mockResolvedValue(undefined),
    };
    const processMail = vi.fn(async (input: Data) =>
        input.operation === 'edit-eml'
            ? { raw: 'bmV3', projection: {} }
            : { projection: {}, from: [], base_size: 2500 },
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
        args: { 'draft-id': 'd', 'patch-file': 'patch' },
    };
    for (let i = 0; i < 30; i++) {
        const result = await draftProgram(artifacts as never, {
            processMail,
        }).step(state, context as never);
        if (result.done) break;
        state = result.state;
    }
    expect(uploadStream).toHaveBeenCalledTimes(2);
    expect(processMail).toHaveBeenCalledWith(
        expect.objectContaining({
            operation: 'edit-eml',
            large: [{ name: 'big.zip', size: 30 * 1024 * 1024, token: 'tok' }],
            patch: expect.objectContaining({ ops: [] }),
        }),
    );
});
it('stages signature images and supplies bytes to the MIME editor', async () => {
    const patch = JSON.stringify({
            ops: [{ op: 'insert_signature', signature_id: 'sig' }],
        }),
        request = vi
            .fn()
            .mockResolvedValueOnce({ raw: 'ZW1s' })
            .mockResolvedValueOnce({
                signatures: [
                    {
                        id: 'sig',
                        content: 'Signature',
                        images: [
                            {
                                cid: 'img',
                                image_name: 'image.png',
                                download_url: 'https://files.example/img',
                            },
                        ],
                    },
                ],
            })
            .mockResolvedValueOnce({ draft_id: 'd' }),
        artifacts = {
            stat: vi.fn(async (_o, id) => ({
                size: id === 'patch' ? patch.length : 3,
            })),
            read: vi.fn(
                async (_o, id) =>
                    new Response(
                        id === 'patch' ? patch : id === 'temp' ? 'ZW1s' : 'abc',
                    ),
            ),
            upload: vi.fn().mockResolvedValue({ id: 'temp' }),
            ingest: vi.fn().mockResolvedValue({ id: 'image', size: 3 }),
            remove: vi.fn().mockResolvedValue(undefined),
        },
        remote = { stream: vi.fn().mockResolvedValue(new Response('abc')) };
    const processMail = vi.fn(async (input: Data) =>
        input.operation === 'edit-eml'
            ? { raw: 'bmV3', projection: {} }
            : { projection: {}, from: [{ address: 'a@example.com' }] },
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
        lark: { request },
    };
    let state: Data = {
        phase: 'start',
        args: { 'draft-id': 'd', 'patch-file': 'patch' },
    };
    for (let i = 0; i < 30; i++) {
        const result = await draftProgram(
            artifacts as never,
            { processMail },
            remote as never,
        ).step(state, context as never);
        if (result.done) break;
        state = result.state;
    }
    expect(processMail).toHaveBeenCalledWith(
        expect.objectContaining({
            operation: 'edit-eml',
            signature_images_by_op: {
                0: [{ name: 'image.png', cid: 'img', data: 'YWJj' }],
            },
        }),
    );
});
it('rewrites local body images to CID and adds private artifact inline operations', async () => {
    const request = vi
            .fn()
            .mockResolvedValueOnce({ raw: 'ZW1s' })
            .mockResolvedValueOnce({ draft_id: 'd' }),
        artifacts = {
            stat: vi.fn().mockResolvedValue({ size: 3 }),
            read: vi.fn(
                async (_o, id) => new Response(id === 'temp' ? 'ZW1s' : 'abc'),
            ),
            upload: vi.fn().mockResolvedValue({ id: 'temp' }),
            remove: vi.fn().mockResolvedValue(undefined),
        },
        processMail = vi.fn(async (input: Data) =>
            input.operation === 'lint'
                ? { cleaned_html: input.body }
                : input.operation === 'edit-eml'
                  ? { raw: 'bmV3', projection: {} }
                  : { projection: {}, from: [] },
        ),
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
        args: { 'draft-id': 'd', body: '<img src="@photo.png">' },
    };
    for (let i = 0; i < 12; i++) {
        const result = await draftProgram(artifacts as never, {
            processMail,
        }).step(state, context as never);
        if (result.done) break;
        state = result.state;
    }
    expect(processMail).toHaveBeenCalledWith(
        expect.objectContaining({
            operation: 'edit-eml',
            patch: expect.objectContaining({
                ops: expect.arrayContaining([
                    expect.objectContaining({
                        op: 'add_inline',
                        path: 'photo.png',
                    }),
                ]),
            }),
            files: { 'photo.png': 'YWJj' },
        }),
    );
});
it('streams new draft attachment payloads while the pure editor only receives placeholders', async () => {
    const patch = JSON.stringify({
            ops: [{ op: 'add_attachment', path: 'report.txt' }],
        }),
        request = vi.fn().mockResolvedValueOnce({ raw: 'ZW1s' }),
        requestStream = vi.fn().mockResolvedValue({ draft_id: 'd' }),
        artifacts = {
            stat: vi.fn(async (_o, id) => ({
                size: id === 'patch' ? patch.length : 3,
            })),
            read: vi.fn(
                async (_o, id) =>
                    new Response(
                        id === 'patch' ? patch : id === 'temp' ? 'ZW1s' : 'abc',
                    ),
            ),
            upload: vi.fn().mockResolvedValue({ id: 'temp' }),
            remove: vi.fn().mockResolvedValue(undefined),
        },
        processMail = vi.fn(async (input: Data) =>
            input.operation === 'edit-eml'
                ? {
                      raw: btoa(
                          'H\n\n' +
                              Object.values(input.files).join('\n\n') +
                              '\n\n',
                      ),
                      projection: {},
                  }
                : { projection: {}, from: [], base_size: 2048 },
        ),
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
            lark: { request, requestStream },
        };
    let state: Data = {
        phase: 'start',
        args: { 'draft-id': 'd', 'patch-file': 'patch' },
    };
    for (let i = 0; i < 15; i++) {
        const result = await draftProgram(artifacts as never, {
            processMail,
        }).step(state, context as never);
        if (result.done) break;
        state = result.state;
    }
    expect(requestStream).toHaveBeenCalledOnce();
    const json = JSON.parse(
        await new Response(requestStream.mock.calls[0]![0].body).text(),
    );
    expect(atob(json.raw)).toContain('YWJj');
});
it('preserves explicit attachment filenames when artifact IDs are opaque', async () => {
    const patch = JSON.stringify({
            ops: [
                {
                    op: 'add_attachment',
                    path: 'opaque',
                    filename: 'report.txt',
                },
            ],
        }),
        request = vi
            .fn()
            .mockResolvedValueOnce({ raw: 'ZW1s' })
            .mockResolvedValueOnce({ draft_id: 'd' }),
        artifacts = {
            stat: vi.fn(async (_o, id) => ({
                size: id === 'patch' ? patch.length : 3,
            })),
            read: vi.fn(
                async (_o, id) =>
                    new Response(
                        id === 'patch' ? patch : id === 'temp' ? 'ZW1s' : 'abc',
                    ),
            ),
            upload: vi.fn().mockResolvedValue({ id: 'temp' }),
            remove: vi.fn().mockResolvedValue(undefined),
        },
        processMail = vi.fn(async (input: Data) =>
            input.operation === 'edit-eml'
                ? { raw: 'bmV3', projection: {} }
                : { projection: {}, from: [], base_size: 2048 },
        ),
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
        args: { 'draft-id': 'd', 'patch-file': 'patch' },
    };
    for (let i = 0; i < 15; i++) {
        const result = await draftProgram(artifacts as never, {
            processMail,
        }).step(state, context as never);
        if (result.done) break;
        state = result.state;
    }
    const edit = processMail.mock.calls.find(
        (c) => c[0].operation === 'edit-eml',
    )![0];
    expect(edit.patch.ops[0].path).toMatch(/\/report\.txt$/);
    expect(edit.files[edit.patch.ops[0].path]).toBe('YWJj');
});

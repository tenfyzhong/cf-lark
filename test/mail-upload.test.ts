import { describe, expect, it, vi } from 'vitest';
import { mailUploadStep } from '../src/capabilities/mail/upload';
const context = {
    selection: { identity: 'user', profileId: 'p', accountId: 'a' },
    grant: {
        id: 'g',
        revoked: false,
        expiresAt: Date.now() + 600000,
        domains: ['mail', 'artifact'],
        permissions: ['read', 'write'],
        profiles: [{ profileId: 'p', identities: ['user'], accounts: ['a'] }],
    },
};
describe('Mail attachment streaming uploads', () => {
    it('uses server block plan and grant-owned range streams', async () => {
        const request = vi
                .fn()
                .mockResolvedValueOnce({
                    upload_id: 'u',
                    block_size: 3,
                    block_num: 2,
                })
                .mockResolvedValueOnce({ file_token: 'token' }),
            uploadStream = vi.fn().mockResolvedValue({});
        const artifacts = {
            stat: vi.fn().mockResolvedValue({ size: 5 }),
            read: vi
                .fn()
                .mockImplementation((_owner, _id, range) =>
                    Promise.resolve(
                        new Response(new Uint8Array(range?.length ?? 5)),
                    ),
                ),
        };
        const ctx = { ...context, lark: { request, uploadStream } };
        let state: any = {
            file: { id: 'artifact', name: 'file.txt', size: 5 },
            openId: 'ou',
            phase: 'prepare',
            forceMultipart: true,
        };
        for (let i = 0; i < 5; i++) {
            const before =
                request.mock.calls.length + uploadStream.mock.calls.length;
            const result = await mailUploadStep(
                state,
                ctx as never,
                artifacts as never,
            );
            expect(
                request.mock.calls.length +
                    uploadStream.mock.calls.length -
                    before,
            ).toBeLessThanOrEqual(1);
            if (result.done) {
                expect(result.file_token).toBe('token');
                break;
            }
            state = result.state;
        }
        expect(artifacts.read.mock.calls.map((c) => c[2])).toEqual([
            { offset: 0, length: 3 },
            { offset: 3, length: 2 },
        ]);
        expect(request.mock.calls[0]![0].body).toMatchObject({
            parent_type: 'email',
            parent_node: 'ou',
            file_name: 'file.txt',
            size: 5,
        });
        expect(uploadStream.mock.calls[1]![0].fields).toMatchObject({
            upload_id: 'u',
            seq: '1',
            size: '2',
        });
    });
    it('rejects invalid upstream part sizes without artifact reads', async () => {
        const artifacts = { read: vi.fn() },
            ctx = {
                ...context,
                lark: {
                    request: vi
                        .fn()
                        .mockResolvedValue({
                            upload_id: 'u',
                            block_size: 0,
                            block_num: 2,
                        }),
                },
            };
        await expect(
            mailUploadStep(
                {
                    file: { id: 'a', name: 'file.txt', size: 25 * 1024 * 1024 },
                    openId: 'ou',
                    phase: 'prepare',
                },
                ctx as never,
                artifacts as never,
            ),
        ).rejects.toThrow();
        expect(artifacts.read).not.toHaveBeenCalled();
    });
});
it('rejects blocked extensions and unknown upload phases before I/O', async () => {
    const request = vi.fn(),
        uploadStream = vi.fn(),
        read = vi.fn();
    const ctx = { ...context, lark: { request, uploadStream } };
    for (const state of [
        {
            phase: 'prepare',
            file: { id: 'a', name: 'run.ExE', size: 1 },
            openId: 'ou',
        },
        {
            phase: 'unknown',
            file: { id: 'a', name: 'safe.txt', size: 1 },
            openId: 'ou',
        },
    ])
        await expect(
            mailUploadStep(state, ctx as never, { read } as never),
        ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(uploadStream).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
});

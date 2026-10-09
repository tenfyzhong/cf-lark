import { expect, it, vi } from 'vitest';
import { okrPrograms } from '../src/capabilities/okr/workflows';
import type { CommandContext } from '../src/ports/capabilities';
it('uploads an owned OKR image as the data part with target fields and preserves filename', async () => {
    const artifacts = { stat: vi.fn().mockResolvedValue({ size: 3 }), read: vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))) };
    const uploadStream = vi.fn().mockResolvedValue({ file_token: 'file', url: 'https://example.test/image' });
    const context = { selection: { profileId: 'p', accountId: 'a', identity: 'user' }, grant: { id: 'g', revoked: false, expiresAt: Date.now() + 60000, domains: ['okr', 'artifact'], permissions: ['read', 'write'], profiles: [{ profileId: 'p', identities: ['user'], accounts: ['a'] }] }, lark: { uploadStream } } as unknown as CommandContext;
    const program = okrPrograms(artifacts as never).find(item => item.id === 'okr-image')!;
    expect(await program.step({ args: { file: 'artifact', name: 'image.png', 'target-id': '1', 'target-type': 'key_result' } }, context)).toEqual({ done: true, output: { file_token: 'file', url: 'https://example.test/image', file_name: 'image.png', size: 3 } });
    expect(uploadStream.mock.calls[0]![0]).toMatchObject({ path: '/open-apis/okr/v1/images/upload', fields: { target_id: '1', target_type: '3' }, file: { field: 'data', name: 'image.png', size: 3 } });
    expect(artifacts.read).toHaveBeenCalledWith('g', 'artifact');
});

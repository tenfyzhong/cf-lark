import { describe, expect, it, vi } from 'vitest';
import { taskCapabilities, taskPrograms } from '../src/capabilities/task/commands';
import type { CommandContext } from '../src/ports/capabilities';
const context = { selection: { identity: 'user', profileId: 'p', accountId: 'a' }, grant: { id: 'g', revoked: false, expiresAt: Date.now() + 600000, domains: ['task', 'artifact'], permissions: ['read', 'write'], profiles: [{ profileId: 'p', identities: ['user'], accounts: ['a'] }] } } as unknown as CommandContext;
describe('Task artifact attachments', () => {
    it('uses grant-owned artifact bytes and preserves all first attachment response fields', async () => {
        const bytes = new Uint8Array([0, 255, 7]);
        const artifacts = { stat: vi.fn().mockResolvedValue({ size: 3 }), read: vi.fn().mockResolvedValue(new Response(bytes)) };
        const upload = vi.fn().mockResolvedValue({ items: [{ guid: 'attachment', size: 3, uploader: { id: 'ou_a' } }] });
        const program = taskPrograms(artifacts as never).find(item => item.id === 'task-attachment')!;
        const result = await program.step({ args: { 'resource-id': 'https://example.test/task?guid=task', file: 'artifact', name: 'report.bin', 'resource-type': 'task_delivery', 'user-id-type': 'user_id' } }, { ...context, lark: { uploadStream: upload } as never });
        expect(artifacts.stat).toHaveBeenCalledWith('g', 'artifact');
        expect(artifacts.read).toHaveBeenCalledWith('g', 'artifact');
        expect(upload.mock.calls[0]![0]).toMatchObject({ path: '/open-apis/task/v2/attachments/upload', query: { user_id_type: 'user_id' }, fields: { resource_id: 'task', resource_type: 'task_delivery' }, file: { name: 'report.bin', field: 'file' } });
        expect(new Uint8Array(await new Response(upload.mock.calls[0]![0].file.body).arrayBuffer())).toEqual(bytes);
        expect(result).toEqual({ done: true, output: { guid: 'attachment', size: 3, uploader: { id: 'ou_a' } } });
    });
    it('checks size before buffering and rejects missing artifact read authorization', async () => {
        const artifacts = { stat: vi.fn().mockResolvedValue({ size: 50 * 1024 * 1024 + 1 }), read: vi.fn() };
        const program = taskPrograms(artifacts as never).find(item => item.id === 'task-attachment')!;
        await expect(program.step({ args: { 'resource-id': 'task', file: 'artifact' } }, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(artifacts.read).not.toHaveBeenCalled();
        await expect(program.step({ args: { 'resource-id': 'task', file: 'artifact' } }, { ...context, grant: { ...context.grant, domains: ['task'] } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
    it('previews multipart fields without accessing artifacts', async () => {
        const start = vi.fn();
        const capability = taskCapabilities({ start } as never).find(item => item.definition.id === 'task.+upload-attachment')!;
        const preview = await capability.preview({ 'resource-id': 'task', file: 'artifact' });
        expect(preview).toMatchObject({ multipart: { fields: { resource_id: 'task', resource_type: 'task' }, artifactId: 'artifact' } });
        expect(start).not.toHaveBeenCalled();
    });
});

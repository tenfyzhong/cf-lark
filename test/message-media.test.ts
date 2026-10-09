import { describe, expect, it, vi } from 'vitest';
import { messageSendCapability } from '../src/capabilities/shortcuts/messages';
import type { CommandContext } from '../src/ports/capabilities';
const fixture = () => {
    const request = vi.fn(async () => ({ message_id: 'om_fixture' }));
    const context: CommandContext = { lark: { request }, selection: { profileId: 'p', identity: 'bot' },
        grant: { id: 'g', expiresAt: Date.now() + 1000, revoked: false, domains: ['im'], permissions: ['write'], profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }] } };
    return { request, context, command: messageSendCapability() };
};
describe('message media and attachment branches', () => {
    it.each([
        { args: { image: 'img_fixture' }, type: 'image', content: { image_key: 'img_fixture' } },
        { args: { file: 'file_fixture' }, type: 'file', content: { file_key: 'file_fixture' } },
        { args: { audio: 'file_audio' }, type: 'audio', content: { file_key: 'file_audio' } },
        { args: { video: 'file_video', 'video-cover': 'img_cover' }, type: 'media', content: { file_key: 'file_video', image_key: 'img_cover' } },
    ])('sends existing media keys without uploading: $type', async ({ args, type, content }) => {
        const { request, context, command } = fixture();
        const input = { 'user-id': 'ou_fixture', ...args };
        const plan = await command.preview(input) as { body: { msg_type: string; content: string } };
        expect(plan.body.msg_type).toBe(type); expect(JSON.parse(plan.body.content)).toEqual(content);
        expect(request).not.toHaveBeenCalled();
        await command.execute(input, context); expect(request).toHaveBeenCalledExactlyOnceWith(plan);
    });
    it('infers post for attachment-only messages and deduplicates file keys in order', async () => {
        const { command } = fixture();
        const plan = await command.preview({ 'chat-id': 'oc_fixture', attachment: ['file_b', 'file_a', 'file_b'] }) as { body: { msg_type: string; content: string } };
        expect(plan.body.msg_type).toBe('post');
        expect(JSON.parse(plan.body.content)).toEqual({ zh_cn: { content: [] }, files: [{ key: 'file_b' }, { key: 'file_a' }] });
        const withBody = await command.preview({ 'chat-id': 'oc_fixture', markdown: '**Text**', attachment: ['file_a'] }) as typeof plan;
        expect(JSON.parse(withBody.body.content)).toMatchObject({ files: [{ key: 'file_a' }] });
    });
    it.each([
        { video: 'file_a' }, { 'video-cover': 'img_a' }, { image: 'img_a', file: 'file_b' }, { image: 'img_a', text: 'Text' },
        { image: 'img_a', 'msg-type': 'text' }, { text: 'Text', attachment: ['file_a'] }, { attachment: ['bad'] },
        { attachment: ['file_a'], 'msg-type': 'text' }, { attachment: ['file_a'], content: '{"files":[]}', 'msg-type': 'post' },
    ])('rejects conflicting media and attachment arguments: %j', async (args) => {
        const { command, context, request } = fixture();
        await expect(command.preview({ 'user-id': 'ou_fixture', ...args })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(command.execute({ 'user-id': 'ou_fixture', ...args }, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(request).not.toHaveBeenCalled();
    });
    it('normalizes text mentions before encoding valid content JSON', async () => {
        const { command } = fixture();
        const plan = await command.preview({ 'user-id': 'ou_fixture', text: '<at open_id="ou_other"/> Hello' }) as { body: { content: string } };
        expect(JSON.parse(plan.body.content)).toEqual({ text: '<at user_id="ou_other"> Hello' });
    });
});

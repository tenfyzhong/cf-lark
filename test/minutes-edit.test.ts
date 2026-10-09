import { describe, expect, it, vi } from 'vitest';
import { minutesCapabilities } from '../src/capabilities/minutes/commands';
import type { ApiRequest } from '../src/ports/lark';
import type { CommandContext } from '../src/ports/capabilities';
function setup(reply = {}) {
    const request = vi.fn(async (_request: ApiRequest) => reply);
    const context = { lark: { request }, selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user', 'bot'] }], domains: ['vc', 'minutes', 'artifact'], permissions: ['read', 'write'] } } as CommandContext;
    return { request, context, get: (name: string) => minutesCapabilities().find(c => c.definition.id === `minutes.+${name}`)! };
}
describe('Minutes edits', () => {
    it('preserves title whitespace, trims summary and emits mutation summaries', async () => {
        const { get, request, context } = setup();
        expect(await get('update').execute({ 'minute-token': 't', topic: ' Title ' }, context)).toEqual({ minute_token: 't', topic: ' Title ' });
        expect(request.mock.calls[0]![0]).toEqual({ method: 'PATCH', path: '/open-apis/minutes/v1/minutes/t', body: { topic: ' Title ' } });
        expect(await get('summary').execute({ 'minute-token': 't', summary: ' **Hello** ' }, context)).toEqual({ minute_token: 't', updated: true });
        expect(request.mock.calls[1]![0].body).toEqual({ summary: '**Hello**' });
        await expect(get('summary').preview({ 'minute-token': 't', summary: '  ' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('extracts upload tokens without fetching returned URLs and applies explicit permission', async () => {
        const { get, request, context } = setup({ minute_url: 'https://meetings.feishu.cn/minutes/mm123/?q=1' });
        expect(await get('upload').execute({ 'file-token': 'file1' }, context)).toEqual({ minute_url: 'https://meetings.feishu.cn/minutes/mm123/?q=1', minute_token: 'mm123' });
        expect(await get('apply-permission').execute({ 'minute-token': 'm', perm: 'edit' }, context)).toEqual({ minute_token: 'm', perm: 'edit' });
        expect(request.mock.calls[1]![0].path).toBe('/open-apis/minutes/v1/minutes/m/permissions/apply');
    });
    it('prefers speaker IDs, supports legacy user IDs, rejects equal legacy identities', async () => {
        const { get, request, context } = setup();
        await get('speaker-replace').execute({ 'minute-token': 't', 'from-speaker-id': 'speaker', 'from-user-id': 'ignored', 'to-user-id': 'ou_b' }, context);
        expect(request.mock.calls[0]![0]).toMatchObject({ query: { user_id_type: 'open_id' }, body: { from_speaker_id: 'speaker', to_user_id: 'ou_b' } });
        expect(request.mock.calls[0]![0].body).not.toHaveProperty('from_user_id');
        await expect(get('speaker-replace').preview({ 'minute-token': 't', 'from-user-id': 'ou_b', 'to-user-id': 'ou_b' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('preserves ordered mixed todos and explicit false, rejects batch/single conflicts', async () => {
        const { get, request, context } = setup();
        const items = [{ operation: 'add', content: ' New ', is_done: false }, { operation: 'delete', todo_id: 'old' }];
        expect(await get('todo').execute({ 'minute-token': 't', todos: JSON.stringify(items) }, context)).toEqual({ minute_token: 't', count: 2, updated: true });
        expect(request.mock.calls[0]![0].body).toEqual({ todo_items: [{ operation: 'add', content: 'New', is_done: false }, items[1]] });
        await expect(get('todo').preview({ 'minute-token': 't', todos: items, 'is-done': false })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(get('todo').preview({ 'minute-token': 't', operation: 'add', todo: 'x' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('reports partial word replacement without retrying successful words', async () => {
        const { get, request, context } = setup({ replace_word_counts: [{ source_word: 'old', replace_count: '2' }] });
        const result = await get('word-replace').execute({ 'minute-token': 't', 'replace-words': [{ source_word: 'old', target_word: '' }, { source_word: 'missing', target_word: 'new' }] }, context);
        expect(result).toEqual({ minute_token: 't', message: 'Succeeded: old; Failed: missing. Do not reprocess words that already succeeded.' });
        expect(request).toHaveBeenCalledTimes(1);
        await expect(get('word-replace').preview({ 'minute-token': 't', 'replace-words': [{ source_word: 'old', target_word: 'a' }, { source_word: ' old ', target_word: 'b' }] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('does not report replacement success when counts are missing or all zero', async () => {
        for (const response of [{}, { replace_word_counts: [] }]) {
            const { get, request, context } = setup(response);
            await expect(get('word-replace').execute({ 'minute-token': 't', 'replace-words': '[{"source_word":"old","target_word":"new"}]' }, context)).rejects.toBeDefined();
            expect(request).toHaveBeenCalledTimes(1);
        }
    });
});

import { describe, expect, it, vi } from 'vitest';
import { shortcutCapabilities } from '../src/capabilities/shortcuts/index';
import { Dispatcher } from '../src/application/dispatcher';
import { Registry } from '../src/capabilities/registry';
import { fixtureValidator } from './support/schema-validator';
import type { Grant, JsonObject } from '../src/domain/models';

const grant: Grant = { id: 'g', expiresAt: 2000, revoked: false,
    profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user', 'bot'] }],
    domains: ['docs', 'im'], permissions: ['read', 'write'] };
const setup = () => {
    const request = vi.fn(async (_input: unknown): Promise<JsonObject> => ({ message_id: 'm' }));
    const pause = vi.fn(async () => {});
    const dispatcher = new Dispatcher(new Registry(shortcutCapabilities(pause)), fixtureValidator(), async () => ({ request }), () => 1000);
    const execute = (command: string, args: JsonObject, dryRun = false) => dispatcher.execute({ command, args, identity: 'user', dryRun }, grant);
    return { request, pause, dispatcher, execute };
};

describe('inline shortcut workflows', () => {
    it('discovers document creation and message sending with write requirements', () => {
        const { dispatcher } = setup();
        expect(dispatcher.search({ query: 'create document' }, grant).commands.map((x) => x.id)).toContain('docs.+create');
        expect(dispatcher.search({ query: 'send message' }, grant).commands.map((x) => x.id)).toContain('im.+messages-send');
        expect(dispatcher.search({ query: 'send' }, { ...grant, permissions: ['read'] })).toMatchObject({
            commands: [], authorization: { permissions: ['read'], domains: ['docs', 'im'], writeAccess: false, requiredWriteScope: 'mcp:write' },
        });
    });
    it('previews and sends plain text with JSON content and an idempotency key', async () => {
        const { execute, request } = setup();
        const args = { 'user-id': 'ou_recipient', text: 'Hello "reader"', 'idempotency-key': 'once' };
        const expected = { method: 'POST', path: '/open-apis/im/v1/messages', query: { receive_id_type: 'open_id' },
            body: { receive_id: 'ou_recipient', msg_type: 'text', content: JSON.stringify({ text: 'Hello "reader"' }), uuid: 'once' } };
        expect(await execute('im.+messages-send', args, true)).toMatchObject({ data: expected });
        expect(request).not.toHaveBeenCalled();
        await execute('im.+messages-send', args);
        expect(request).toHaveBeenCalledExactlyOnceWith(expected);
    });
    it('converts Markdown to a post and preserves structured JSON content', async () => {
        const { execute, request } = setup();
        await execute('im.+messages-send', { 'chat-id': 'oc_chat', markdown: '**Hello**' });
        expect(request.mock.calls[0]![0]).toMatchObject({ body: { msg_type: 'post', content: JSON.stringify({ zh_cn: { content: [[{ tag: 'md', text: '**Hello**' }]] } }) } });
        await execute('im.+messages-send', { 'chat-id': 'oc_chat', 'msg-type': 'image', content: '{"image_key":"img_key"}' });
        expect(request.mock.calls[1]![0]).toMatchObject({ body: { msg_type: 'image', content: '{"image_key":"img_key"}' } });
    });
    it.each([
        {}, { 'user-id': 'wrong', text: 'Hi' }, { 'chat-id': 'oc_c', 'user-id': 'ou_u', text: 'Hi' },
        { 'chat-id': 'oc_c', text: 'Hi', markdown: 'Hi' }, { 'chat-id': 'oc_c', content: 'bad' },
        { 'chat-id': 'oc_c', content: 'null' }, { 'chat-id': 'oc_c', text: 'Hi', 'msg-type': 'image' },
        { 'chat-id': 'oc_c', text: 'Hi', 'idempotency-key': 'x'.repeat(51) },
        { 'chat-id': 'oc_c', image: '/local/image.png' },
    ])('rejects invalid send input without sending: %j', async (args) => {
        const { execute, request } = setup();
        await expect(execute('im.+messages-send', args, true)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        await expect(execute('im.+messages-send', args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(request).not.toHaveBeenCalled();
    });
    it('creates Markdown with escaped title and one parent location', async () => {
        const { execute, request } = setup();
        request.mockResolvedValue({ document: { document_id: 'd', url: 'https://example.test/docx/d' } });
        const args = { title: 'A & B', content: '**Text**', 'doc-format': 'markdown', 'parent-token': 'folder' };
        expect(await execute('docs.+create', args)).toMatchObject({ data: { document: { document_id: 'd' } } });
        expect(request).toHaveBeenCalledExactlyOnceWith({ method: 'POST', path: '/open-apis/docs_ai/v1/documents', body: {
            format: 'markdown', content: '<title>A &amp; B</title>\n**Text**', extra_param: '{"open_create_async":true}', parent_token: 'folder',
        } });
    });
    it('polls an asynchronous create and never repeats its write', async () => {
        const { execute, request, pause } = setup();
        request.mockResolvedValueOnce({ task: { task_id: 't', status: 'processing' } })
            .mockResolvedValueOnce({ task: { task_id: 't', status: 'processing', poll_after_ms: 1 } })
            .mockResolvedValueOnce({ task: { task_id: 't', status: 'succeeded', result: { create_document: '{"document":{"document_id":"d"}}' } } });
        expect(await execute('docs.+create', { title: 'Example' })).toMatchObject({ data: { document: { document_id: 'd' } } });
        expect(request.mock.calls.slice(1).map(([input]) => input)).toEqual(Array(2).fill({ method: 'GET', path: '/open-apis/docs_ai/v1/async_tasks/t' }));
        expect(pause).toHaveBeenCalledExactlyOnceWith(100);
    });
    it.each([
        { task: { task_id: 't', status: 'failed' } },
        { task: { task_id: 't', status: 'succeeded', result: { create_document: 'bad' } } },
        { task: { status: 'processing' } }, {},
    ])('does not report failed or malformed document results as success', async (response) => {
        const { execute, request } = setup();
        request.mockResolvedValue(response);
        await expect(execute('docs.+create', { title: 'Example' })).rejects.toThrow();
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('bounds polling and reports an uncertain result without retrying creation', async () => {
        const { execute, request } = setup();
        request.mockResolvedValue({ task: { task_id: 't', status: 'processing' } });
        await expect(execute('docs.+create', { title: 'Example' })).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
        expect(request.mock.calls.filter(([input]) => (input as { method: string }).method === 'POST')).toHaveLength(1);
        expect(request.mock.calls.length).toBeLessThanOrEqual(40);
    });
    it.each([{}, { title: ' ' }, { title: 'X', 'parent-token': 'f', 'parent-position': 'my_library' }])('rejects invalid creation input', async (args) => {
        const { execute, request } = setup();
        await expect(execute('docs.+create', args, true)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(request).not.toHaveBeenCalled();
    });
});

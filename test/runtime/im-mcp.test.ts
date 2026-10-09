import { EncryptedWorkflowBlobs } from '../../src/infrastructure/storage/workflow-blobs';
import { ArtifactService } from '../../src/application/artifacts';
import { SqliteArtifactLedger } from '../../src/infrastructure/storage/artifact-ledger';
import { PrivateR2Bucket } from '../../src/infrastructure/storage/r2-bucket';
import { env, runInDurableObject } from 'cloudflare:test';
import { expect, it, vi } from 'vitest';
import { mcpResponse } from '../../src/adapters/mcp/handler';
import { Dispatcher } from '../../src/application/dispatcher';
import { WorkflowService } from '../../src/application/workflows';
import { Registry } from '../../src/capabilities/registry';
import { imCapabilities, imPrograms } from '../../src/capabilities/im/commands';
import { workflowCapability } from '../../src/capabilities/workflow/resume';
import { SqliteWorkflowStore } from '../../src/infrastructure/storage/workflow-store';
import { SecretBox } from '../../src/infrastructure/crypto/secret-box';
import { SchemaValidator } from '../../src/infrastructure/validation/schema-validator';
import { imCardFormatter } from '../../src/infrastructure/documents/adapter';
import type { Env } from '../../src/bootstrap/worker';
import type { Grant, JsonObject } from '../../src/domain/models';
import type { ApiRequest, LarkClient } from '../../src/ports/lark';
const grant: Grant = { id: 'native-im', expiresAt: Date.now() + 3600000, revoked: false, profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }], domains: ['im', 'workflow', 'artifact'], permissions: ['read', 'write'] };
async function call(dispatcher: Dispatcher, command: string, args: JsonObject, dryRun = false, authorization: Grant = grant): Promise<JsonObject> {
    const response = await mcpResponse(new Request('https://service.example/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lark_execute', arguments: { command, args, identity: 'bot', dryRun } } }) }), dispatcher, authorization);
    const body = await response.json() as { result: { isError?: boolean; structuredContent: JsonObject; content: unknown } };
    expect(body.result.isError, JSON.stringify(body.result.content)).not.toBe(true);
    return body.result.structuredContent.data as JsonObject;
}
async function complete(dispatcher: Dispatcher, command: string, args: JsonObject, authorization: Grant = grant): Promise<JsonObject> {
    let result = await call(dispatcher, command, args, false, authorization);
    for (let i = 0; result.status === 'pending' && i < 30; i++) result = await call(dispatcher, 'workflow.resume', { id: result.workflowId }, false, authorization);
    expect(result.status).not.toBe('pending');
    return (result.status === 'completed' ? result.output : result) as JsonObject;
}
async function fixture(name: string, client: LarkClient, run: (dispatcher: Dispatcher, artifacts: ArtifactService) => Promise<void>): Promise<void> {
    const stub = (env as unknown as Env).AUTHORITY.getByName(`im-mcp-${name}`);
    await runInDurableObject(stub, async (_instance, state) => {
        const artifacts = new ArtifactService(new SqliteArtifactLedger(state.storage.sql, { maxBytes: 2_000_000_000, maxClassA: 100000, maxClassB: 100000 }), new PrivateR2Bucket((env as unknown as Env).ARTIFACTS));
        const encryption = new SecretBox('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
        const store = new SqliteWorkflowStore(state.storage.sql, encryption, new EncryptedWorkflowBlobs(artifacts, encryption));
        const workflows = new WorkflowService(store, imPrograms({ cardFormatter: imCardFormatter, artifacts }), async () => client);
        const dispatcher = new Dispatcher(new Registry([...imCapabilities({ workflows, artifacts }), workflowCapability(workflows)]), new SchemaValidator(), async () => client);
        await run(dispatcher, artifacts);
        for (const row of state.storage.sql.exec('SELECT payload FROM workflows')) expect(String(row.payload)).not.toContain('Hello card');
    });
}
it('runs card reads through MCP, compiled schemas, durable SQLite and the exact native engine', async () => {
    const request = vi.fn(async (input: ApiRequest): Promise<JsonObject> => {
        expect(input.path).toBe('/open-apis/im/v1/messages/mget');
        expect(input.queryEncoding).toEqual({ message_ids: 'repeat' });
        return { items: [{ message_id: 'om_card', msg_type: 'interactive', sender: { id: 'ou_a', sender_name: 'Sam' }, body: { content: JSON.stringify({ header: { title: { content: 'Release' } }, elements: [{ tag: 'markdown', content: 'Hello card' }] }) } }] };
    });
    await fixture('card', { request, brand: 'feishu' }, async dispatcher => {
        const output = await complete(dispatcher, 'im.+messages-mget', { 'message-ids': 'om_card', 'no-reactions': true });
        expect(output).toMatchObject({ messages: [{ content: '**Release**\nHello card', sender: { id: 'ou_a', name: 'Sam' } }] });
        expect(request).toHaveBeenCalledTimes(1);
    });
});
it('sends and edits supported content through MCP while previews remain isolated', async () => {
    const request = vi.fn(async (): Promise<JsonObject> => ({ message_id: 'om_sent', chat_id: 'oc_chat', create_time: '1767225600000' }));
    await fixture('send', { request }, async dispatcher => {
        await call(dispatcher, 'im.+messages-send', { 'chat-id': 'oc_chat', text: 'Hello' }, true);
        expect(request).not.toHaveBeenCalled();
        const output = await complete(dispatcher, 'im.+messages-send', { 'chat-id': 'oc_chat', text: 'Hello' });
        expect(output).toMatchObject({ message_id: 'om_sent' });
        expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: '/open-apis/im/v1/messages', body: expect.objectContaining({ receive_id: 'oc_chat', msg_type: 'text', content: '{"text":"Hello"}' }) }));
        await complete(dispatcher, 'im.+messages-edit', { 'message-id': 'om_sent', markdown: '**Updated**' });
        expect(request).toHaveBeenCalledTimes(2);
    });
});

it('resumes paginated message reads with read-only authorization', async () => {
    const request = vi.fn(async (input: ApiRequest): Promise<JsonObject> => ({ items: [{ message_id: input.query?.page_token ? 'om_second' : 'om_first', msg_type: 'text', body: { content: '{"text":"Page"}' } }], has_more: !input.query?.page_token, page_token: input.query?.page_token ? '' : 'next' }));
    await fixture('read-only', { request }, async dispatcher => {
        const output = await complete(dispatcher, 'im.+chat-messages-list', { 'chat-id': 'oc_a', 'page-all': true, 'no-reactions': true }, { ...grant, permissions: ['read'] });
        expect(output).toMatchObject({ total: 2, messages: [{ message_id: 'om_first' }, { message_id: 'om_second' }] });
        expect(request).toHaveBeenCalledTimes(2);
    });
});

it('uploads private media and downloads resources through native R2 and resumable MCP', async () => {
    const request = vi.fn(async (): Promise<JsonObject> => ({ message_id: 'om_media', chat_id: 'oc_a' }));
    const uploadStream = vi.fn(async (input: { file: { body: ReadableStream; size: number; name: string } }): Promise<JsonObject> => { expect(await new Response(input.file.body).text()).toBe('fixture bytes'); expect(input.file.name).toBe('report.pdf'); return { file_key: 'file_uploaded' }; });
    const download = vi.fn(async () => new Response('download bytes', { headers: { 'content-length': '14', 'content-disposition': 'attachment; filename="report.pdf"' } }));
    await fixture('media', { request, ...{ uploadStream, download } }, async (dispatcher, artifacts) => {
        const blob = new Blob(['fixture bytes']);
        const artifact = await artifacts.upload(grant.id, blob.size, blob.stream());
        expect(await complete(dispatcher, 'im.+messages-send', { 'chat-id': 'oc_a', file: `artifact:${artifact.id}/report.pdf` })).toMatchObject({ message_id: 'om_media' });
        expect(uploadStream).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledTimes(1);
        const result = await complete(dispatcher, 'im.+messages-resources-download', { 'message-id': 'om_media', 'file-key': 'file_uploaded', type: 'file' });
        expect(result).toMatchObject({ size_bytes: 14, saved_path: 'report.pdf' });
        expect(new TextDecoder().decode(await (await artifacts.read(grant.id, String(result.artifact_id))).arrayBuffer())).toBe('download bytes');
    });
});

it('completes large page-all reads through encrypted spill without artifact or write consent', async () => {
    const largeText = 'large-private-message-'.repeat(1000);
    const request = vi.fn(async (input: ApiRequest): Promise<JsonObject> => ({ items: Array.from({ length: 30 }, (_, i) => ({ message_id: `om_${input.query?.page_token ? 'second' : 'first'}_${i}`, msg_type: 'text', body: { content: JSON.stringify({ text: largeText }) } })), has_more: !input.query?.page_token, page_token: input.query?.page_token ? '' : 'next' }));
    await fixture('large-read', { request }, async dispatcher => {
        const output = await complete(dispatcher, 'im.+chat-messages-list', { 'chat-id': 'oc_a', 'page-all': true, 'no-reactions': true }, { ...grant, domains: ['im', 'workflow'], permissions: ['read'] });
        expect(output.total).toBe(60);
        expect(output.messages).toHaveLength(60);
        expect(new Set((output.messages as JsonObject[]).map(message => message.message_id)).size).toBe(60);
        expect((output.messages as JsonObject[])[59]!.content).toBe(largeText);
        expect(request).toHaveBeenCalledTimes(2);
    });
}, 30000);

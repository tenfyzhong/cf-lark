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
import { docsWriteCapabilities, docsWritePrograms } from '../../src/capabilities/docs/writes';
import { taskCapabilities, taskPrograms } from '../../src/capabilities/task/commands';
import { workflowCapability } from '../../src/capabilities/workflow/resume';
import { SqliteWorkflowStore } from '../../src/infrastructure/storage/workflow-store';
import { SecretBox } from '../../src/infrastructure/crypto/secret-box';
import { SchemaValidator } from '../../src/infrastructure/validation/schema-validator';
import type { Env } from '../../src/bootstrap/worker';
import type { Grant, JsonObject } from '../../src/domain/models';
import type { ApiRequest, LarkClient } from '../../src/ports/lark';
const grant: Grant = { id: 'native-business', expiresAt: Date.now() + 3600000, revoked: false, profiles: [{ profileId: 'p', identities: ['user'], accounts: ['a'] }], domains: ['docs', 'task', 'workflow', 'artifact'], permissions: ['read', 'write'] };
async function call(dispatcher: Dispatcher, command: string, args: JsonObject, dryRun = false, authorization: Grant = grant): Promise<JsonObject> {
    const response = await mcpResponse(new Request('https://service.example/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lark_execute', arguments: { command, args, identity: 'user', dryRun } } }) }), dispatcher, authorization);
    const body = await response.json() as { result: { isError?: boolean; structuredContent: JsonObject; content: unknown } };
    expect(body.result.isError, JSON.stringify(body.result.content)).not.toBe(true);
    return body.result.structuredContent.data as JsonObject;
}
async function complete(dispatcher: Dispatcher, command: string, args: JsonObject, authorization: Grant = grant, advance: (ms: number) => void = () => {}): Promise<JsonObject> {
    let result = await call(dispatcher, command, args, false, authorization);
    for (let i = 0; result.status === 'pending' && i < 30; i++) {
        const delay = Number(result.retryAfter ?? 0);
        if (delay > 0) {
            expect(Number(result.nextRunAt)).toBeGreaterThan(0);
            const held = await call(dispatcher, 'workflow.resume', { id: result.workflowId }, false, authorization);
            expect(held).toMatchObject({ status: 'pending', workflowId: result.workflowId, retryAfter: delay, nextRunAt: result.nextRunAt });
            advance(delay);
        }
        result = await call(dispatcher, 'workflow.resume', { id: result.workflowId }, false, authorization);
    }
    expect(result.status).toBe('completed');
    return (result.status === 'completed' ? result.output : result) as JsonObject;
}
async function fixture(name: string, client: LarkClient, run: (dispatcher: Dispatcher, artifacts: ArtifactService, advance: (ms: number) => void) => Promise<void>): Promise<void> {
    const stub = (env as unknown as Env).AUTHORITY.getByName(`business-mcp-${name}`);
    await runInDurableObject(stub, async (_instance, state) => {
        const artifacts = new ArtifactService(new SqliteArtifactLedger(state.storage.sql, { maxBytes: 2_000_000_000, maxClassA: 100000, maxClassB: 100000 }), new PrivateR2Bucket((env as unknown as Env).ARTIFACTS));
        const encryption = new SecretBox('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
        const store = new SqliteWorkflowStore(state.storage.sql, encryption, new EncryptedWorkflowBlobs(artifacts, encryption));
        let now = Date.now();
        const workflows = new WorkflowService(store, [...docsWritePrograms(artifacts), ...taskPrograms(artifacts)], async () => client, () => now);
        const dispatcher = new Dispatcher(new Registry([...docsWriteCapabilities(workflows), ...taskCapabilities(workflows), workflowCapability(workflows)]), new SchemaValidator(), async () => client);
        await run(dispatcher, artifacts, ms => { now += ms; });
    });
}
it('creates a document through MCP without an explicit profile or account', async () => {
    const request = vi.fn(async (input: ApiRequest): Promise<JsonObject> => {
        if (input.method === 'POST') {
            expect(input.path).toBe('/open-apis/docs_ai/v1/documents');
            expect(input.body).toMatchObject({ format: 'xml', content: '<title>Monthly report</title>\n<p>Completed work</p>' });
            return { task: { task_id: 'create-task', status: 'processing' } };
        }
        expect(input.path).toBe('/open-apis/docs_ai/v1/async_tasks/create-task');
        return { task: { task_id: 'create-task', status: 'succeeded', result: { create_document: JSON.stringify({ document: { document_id: 'doc-created' } }) } } };
    });
    await fixture('create', { request, brand: 'feishu' }, async (dispatcher, _artifacts, advance) => {
        const args = { title: 'Monthly report', content: '<p>Completed work</p>' };
        await call(dispatcher, 'docs.+create', args, true);
        expect(request).not.toHaveBeenCalled();
        const output = await complete(dispatcher, 'docs.+create', args, grant, advance);
        expect(output).toMatchObject({ document: { document_id: 'doc-created', url: 'https://www.feishu.cn/docx/doc-created' } });
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls.filter(([input]) => input.method === 'POST')).toHaveLength(1);
    });
});
it('reads monthly tasks with automatic account selection and read-only pagination', async () => {
    const request = vi.fn(async (input: ApiRequest): Promise<JsonObject> => {
        expect(input.path).toBe('/open-apis/task/v2/tasks');
        expect(input.query).toMatchObject({ type: 'my_tasks', completed: 'false', page_size: 50 });
        return input.query?.page_token ? { items: [{ guid: 'october', summary: 'Monthly report', due: { timestamp: String(Date.parse('2026-10-31T12:00:00Z')) }, completed_at: '0' }], has_more: false }
            : { items: [{ guid: 'november', summary: 'Later report', due: { timestamp: String(Date.parse('2026-11-01T00:00:00Z')) } }], has_more: true, page_token: 'next' };
    });
    await fixture('tasks', { request }, async dispatcher => {
        const output = await complete(dispatcher, 'task.+get-my-tasks', { complete: false, 'due-start': '2026-10-01', 'due-end': '2026-10-31' }, { ...grant, domains: ['task', 'workflow'], permissions: ['read'] });
        expect(output).toMatchObject({ items: [{ guid: 'october', summary: 'Monthly report', completed: false, due_at: '2026-10-31T12:00:00Z' }], has_more: false });
        expect(output.items).toHaveLength(1);
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls[1]![0].query?.page_token).toBe('next');
    });
});

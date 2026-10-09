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
import { rawApiCapability, rawApiPrograms } from '../../src/capabilities/raw-api/commands';
import { baseRecordFormatter } from '../../src/infrastructure/documents/adapter';
import { workflowCapability } from '../../src/capabilities/workflow/resume';
import { SqliteWorkflowStore } from '../../src/infrastructure/storage/workflow-store';
import { SecretBox } from '../../src/infrastructure/crypto/secret-box';
import { SchemaValidator } from '../../src/infrastructure/validation/schema-validator';
import type { Env } from '../../src/bootstrap/worker';
import type { Grant, JsonObject } from '../../src/domain/models';
import type { ApiRequest, LarkClient } from '../../src/ports/lark';
const grant: Grant = { id: 'native-raw-api', expiresAt: Date.now() + 3600000, revoked: false, profiles: [{ profileId: 'p', identities: ['user'], accounts: ['a'] }], domains: ['api', 'workflow', 'artifact'], permissions: ['read', 'write'] };
async function call(dispatcher: Dispatcher, command: string, args: JsonObject, dryRun = false, authorization: Grant = grant): Promise<JsonObject> {
    const response = await mcpResponse(new Request('https://service.example/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lark_execute', arguments: { command, args, identity: 'user', dryRun } } }) }), dispatcher, authorization);
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
    const stub = (env as unknown as Env).AUTHORITY.getByName(`raw-api-mcp-${name}`);
    await runInDurableObject(stub, async (_instance, state) => {
        const artifacts = new ArtifactService(new SqliteArtifactLedger(state.storage.sql, { maxBytes: 2_000_000_000, maxClassA: 100000, maxClassB: 100000 }), new PrivateR2Bucket((env as unknown as Env).ARTIFACTS));
        const encryption = new SecretBox('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
        const store = new SqliteWorkflowStore(state.storage.sql, encryption, new EncryptedWorkflowBlobs(artifacts, encryption));
        const workflows = new WorkflowService(store, rawApiPrograms({artifacts,formatter:baseRecordFormatter}), async () => client);
        const dispatcher = new Dispatcher(new Registry([rawApiCapability({workflows,artifacts,formatter:baseRecordFormatter}), workflowCapability(workflows)]), new SchemaValidator(), async () => client);
        await run(dispatcher, artifacts);
    });
}
it('runs raw paginated reads and exact jq through native MCP without write consent', async () => {
    const request = vi.fn(async (input: ApiRequest): Promise<JsonObject> => ({ items: [{ id: input.query?.page_token ? 'second' : 'first' }], has_more: !input.query?.page_token, page_token: input.query?.page_token ? '' : 'next' }));
    await fixture('pagination', { request }, async dispatcher => {
        let result = await call(dispatcher, 'api.request', { method: 'GET', path: 'preview/v1/items', 'page-all': true, 'page-delay': 1, jq: '.data.items | map(.id)' }, false, { ...grant, permissions: ['read'] });
        expect(result.status).toBe('pending');
        await new Promise(resolve => setTimeout(resolve, 5));
        result = await call(dispatcher, 'workflow.resume', { id: result.workflowId }, false, { ...grant, permissions: ['read'] });
        expect(result).toMatchObject({ status: 'completed', output: [['first','second']] });
        expect(request).toHaveBeenCalledTimes(2);
    });
});
it('previews raw artifact writes without reading private input or contacting Lark', async () => {
    const request=vi.fn(async():Promise<JsonObject>=>({id:'created'}));
    await fixture('artifact', { request }, async(dispatcher,artifacts)=>{
        const blob=new Blob(['{"title":"New"}']);const artifact=await artifacts.upload(grant.id,blob.size,blob.stream());
        await call(dispatcher,'api.request',{method:'POST',path:'preview/v1/items',data:'@artifact:missing'},true);
        expect(request).not.toHaveBeenCalled();
        expect(await complete(dispatcher,'api.request',{method:'POST',path:'preview/v1/items',data:`@artifact:${artifact.id}`})).toMatchObject({id:'created'});
        expect(request).toHaveBeenCalledWith(expect.objectContaining({method:'POST',body:{title:'New'}}));
    });
});

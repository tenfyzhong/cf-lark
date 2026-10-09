import { env, runInDurableObject } from 'cloudflare:test';
import { expect, it, vi } from 'vitest';
import { ArtifactService } from '../../src/application/artifacts';
import { Dispatcher } from '../../src/application/dispatcher';
import { WorkflowService } from '../../src/application/workflows';
import { mcpResponse } from '../../src/adapters/mcp/handler';
import { appsCapabilities } from '../../src/capabilities/apps/commands';
import { appsPrograms } from '../../src/capabilities/apps/programs';
import { validateHtmlArchive } from '../../src/capabilities/apps/html';
import { Registry } from '../../src/capabilities/registry';
import { workflowCapability } from '../../src/capabilities/workflow/resume';
import { SecretBox } from '../../src/infrastructure/crypto/secret-box';
import { SqliteArtifactLedger } from '../../src/infrastructure/storage/artifact-ledger';
import { PrivateR2Bucket } from '../../src/infrastructure/storage/r2-bucket';
import { EncryptedWorkflowBlobs } from '../../src/infrastructure/storage/workflow-blobs';
import { SqliteWorkflowStore } from '../../src/infrastructure/storage/workflow-store';
import { SchemaValidator } from '../../src/infrastructure/validation/schema-validator';
import type { Env } from '../../src/bootstrap/worker';
import type { Grant, JsonObject } from '../../src/domain/models';
import type { ApiRequest } from '../../src/ports/lark';
const grant: Grant = { id: 'apps-native', revoked: false, expiresAt: Date.now() + 3600000, profiles: [{ profileId: 'p', identities: ['user'], accounts: ['u'] }], domains: ['apps', 'workflow', 'artifact'], permissions: ['read', 'write'] };
async function execute(dispatcher: Dispatcher, command: string, args: JsonObject, dryRun = false) {
    const response = await mcpResponse(new Request('https://service.example/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lark_execute', arguments: { command, args, profileId: 'p', accountId: 'u', identity: 'user', dryRun } } }) }), dispatcher, grant);
    const json = await response.json() as any;
    expect(json.result.isError, JSON.stringify(json.result.content)).not.toBe(true);
    return json.result.structuredContent.data as JsonObject;
}
async function complete(dispatcher: Dispatcher, command: string, args: JsonObject) {
    let result = await execute(dispatcher, command, args);
    for (let i = 0; result.status === 'pending' && i < 10; i++) result = await execute(dispatcher, 'workflow.resume', { id: result.workflowId });
    expect(result.status).not.toBe('pending'); return result.status === 'completed' ? result.output as JsonObject : result;
}
async function fixture(name: string, request: (request: ApiRequest) => Promise<JsonObject>, run: (dispatcher: Dispatcher, artifacts: ArtifactService, put: ReturnType<typeof vi.fn>) => Promise<void>) {
    const bindings = env as unknown as Env, stub = bindings.AUTHORITY.getByName(`apps-native-${name}`);
    await runInDurableObject(stub, async (_instance, state) => {
        const encryption = new SecretBox('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='), artifacts = new ArtifactService(new SqliteArtifactLedger(state.storage.sql, { maxBytes: 2_000_000_000, maxClassA: 10000, maxClassB: 10000 }), new PrivateR2Bucket(bindings.ARTIFACTS));
        const put = vi.fn().mockImplementation(async (_url, stream) => { expect(await validateHtmlArchive(stream, false)).toMatchObject({ files: 1 }); return {}; });
        const workflows = new WorkflowService(new SqliteWorkflowStore(state.storage.sql, encryption, new EncryptedWorkflowBlobs(artifacts, encryption)), appsPrograms({ artifacts, remoteFiles: { put, stream: vi.fn(), read: vi.fn() } }), async () => ({ request }));
        const dispatcher = new Dispatcher(new Registry([...appsCapabilities(workflows), workflowCapability(workflows)]), new SchemaValidator(), async () => ({ request }));
        await run(dispatcher, artifacts, put);
    });
}
it('executes SQL and read/write previews through native MCP and compiled schemas', async () => {
    const request = vi.fn().mockResolvedValue({ result: '[{"sql_type":"UPDATE","affected_rows":2}]' });
    await fixture('sql', request, async (dispatcher) => {
        await execute(dispatcher, 'apps.+get', { 'app-id': 'app_a' }, true);
        await execute(dispatcher, 'apps.+create', { name: 'App', 'app-type': 'html' }, true);
        await execute(dispatcher, 'apps.+db-execute', { 'app-id': 'app_a', sql: ' update a set n=1; ' }, true);
        expect(request).not.toHaveBeenCalled();
        expect(await execute(dispatcher, 'apps.+db-execute', { 'app-id': 'app_a', sql: ' update a set n=1; ', yes: true })).toEqual({ command: 'UPDATE', rows_affected: 2 });
        expect(request.mock.calls[0]![0].body).toEqual({ sql: ' update a set n=1; ' });
    });
});
it('publishes a private HTML artifact through gzip packaging, presigned PUT and release', async () => {
    const request = vi.fn().mockResolvedValueOnce({ app: { app_type: 'HTML' } }).mockResolvedValueOnce({ kvs: [{ key: 'upload_url', value: 'https://upload.example/bundle' }, { key: 'tos_path', value: 'bundle' }] }).mockResolvedValueOnce({ release_id: 'release' });
    await fixture('html', request, async (dispatcher, artifacts, put) => {
        const blob = new Blob(['<!doctype html><title>App</title>']), input = await artifacts.upload(grant.id, blob.size, blob.stream());
        expect(await complete(dispatcher, 'apps.+html-publish', { 'app-id': 'app_a', path: input.id, name: 'index.html' })).toEqual({ release_id: 'release' });
        expect(put).toHaveBeenCalledOnce(); expect(request.mock.calls[2]![0].body).toEqual({ tos_path: 'bundle' });
    });
});
it('returns environment secrets only in a private merged artifact', async () => {
    const request = vi.fn().mockResolvedValue({ env_vars: { TOKEN: 'confidential-token', A: 'new' } });
    await fixture('env', request, async (dispatcher, artifacts) => {
        const blob = new Blob(['# local\nA=old\n']), input = await artifacts.upload(grant.id, blob.size, blob.stream());
        const result = await complete(dispatcher, 'apps.+env-pull', { 'app-id': 'app_a', file: input.id });
        expect(JSON.stringify(result)).not.toContain('confidential-token');
        expect(await (await artifacts.read(grant.id, String(result.artifactId))).text()).toBe('# local\nA="new"\nTOKEN="confidential-token"\n');
    });
});

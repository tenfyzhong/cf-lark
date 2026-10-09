import { env, runInDurableObject } from 'cloudflare:test';
import { expect, it, vi } from 'vitest';
import { mcpResponse } from '../../src/adapters/mcp/handler';
import { ArtifactService } from '../../src/application/artifacts';
import { Dispatcher } from '../../src/application/dispatcher';
import { WorkflowService } from '../../src/application/workflows';
import { Registry } from '../../src/capabilities/registry';
import { taskCapabilities, taskPrograms } from '../../src/capabilities/task/commands';
import { okrCapabilities } from '../../src/capabilities/okr/commands';
import { docsWriteCapabilities, docsWritePrograms } from '../../src/capabilities/docs/writes';
import { allDriveCapabilities, drivePrograms } from '../../src/capabilities/drive/index';
import { wikiCapabilities, wikiPrograms } from '../../src/capabilities/wiki/commands';
import { markdownCapabilities, markdownPrograms } from '../../src/capabilities/markdown/commands';
import { workflowCapability } from '../../src/capabilities/workflow/resume';
import { CloudflareContentHasher } from '../../src/infrastructure/crypto/content-hasher';
import { SecretBox } from '../../src/infrastructure/crypto/secret-box';
import { SqliteArtifactLedger } from '../../src/infrastructure/storage/artifact-ledger';
import { PrivateR2Bucket } from '../../src/infrastructure/storage/r2-bucket';
import { EncryptedWorkflowBlobs } from '../../src/infrastructure/storage/workflow-blobs';
import { SqliteWorkflowStore } from '../../src/infrastructure/storage/workflow-store';
import { SchemaValidator } from '../../src/infrastructure/validation/schema-validator';
import type { Env } from '../../src/bootstrap/worker';
import type { ExecutionSelection, Grant, JsonObject } from '../../src/domain/models';
import type { ApiRequest, LarkClient, LarkTransferClient, UploadRequest } from '../../src/ports/lark';
const grant: Grant = { id: 'domain-native', revoked: false, expiresAt: Date.now() + 3600000, profiles: [{ profileId: 'profile', identities: ['user'], accounts: ['account'] }], domains: ['task', 'okr', 'docs', 'drive', 'wiki', 'markdown', 'workflow', 'artifact'], permissions: ['read', 'write'] };
async function call(dispatcher: Dispatcher, command: string, args: JsonObject, authorization = grant, dryRun = false): Promise<JsonObject> {
    const response = await mcpResponse(new Request('https://service.example/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lark_execute', arguments: { command, args, identity: 'user', dryRun } } }) }), dispatcher, authorization);
    const body = await response.json() as { result: { isError?: boolean; content: unknown; structuredContent: JsonObject } };
    expect(body.result.isError, JSON.stringify(body.result.content)).not.toBe(true);
    return body.result.structuredContent.data as JsonObject;
}
async function fixture(name: string, client: LarkClient & Partial<LarkTransferClient>, run: (f: { dispatcher: Dispatcher; artifacts: ArtifactService; advance: (ms: number) => void; complete: (command: string, args: JsonObject, authorization?: Grant) => Promise<JsonObject> }) => Promise<void>) {
    const bindings = env as unknown as Env;
    await runInDurableObject(bindings.AUTHORITY.getByName(`domain-native-${name}`), async (_instance, state) => {
        const artifacts = new ArtifactService(new SqliteArtifactLedger(state.storage.sql, { maxBytes: 2_000_000_000, maxClassA: 100000, maxClassB: 100000 }), new PrivateR2Bucket(bindings.ARTIFACTS));
        const encryption = new SecretBox('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
        const store = new SqliteWorkflowStore(state.storage.sql, encryption, new EncryptedWorkflowBlobs(artifacts, encryption));
        let now = Date.now();
        const createClient = async (selection: ExecutionSelection) => { expect(selection).toEqual({ profileId: 'profile', accountId: 'account', identity: 'user' }); return client; };
        const workflows = new WorkflowService(store, [...taskPrograms(artifacts), ...docsWritePrograms(artifacts), ...drivePrograms(artifacts, new CloudflareContentHasher()), ...wikiPrograms(), ...markdownPrograms(artifacts)], createClient, () => now);
        const dispatcher = new Dispatcher(new Registry([...taskCapabilities(workflows), ...okrCapabilities(), ...docsWriteCapabilities(workflows), ...allDriveCapabilities({ workflows, artifacts }), ...wikiCapabilities(workflows), ...markdownCapabilities(workflows), workflowCapability(workflows)]), new SchemaValidator(), createClient);
        const complete = async (command: string, args: JsonObject, authorization = grant) => {
            let result = await call(dispatcher, command, args, authorization);
            for (let i = 0; result.status === 'pending' && i < 80; i++) { now += Number(result.retryAfter ?? 0); result = await call(dispatcher, 'workflow.resume', { id: result.workflowId }, authorization); }
            expect(result.status).not.toBe('pending');
            return (result.status === 'completed' ? result.output : result) as JsonObject;
        };
        await run({ dispatcher, artifacts, advance: ms => { now += ms; }, complete });
        if (name === 'tasks') {
            const row = [...state.storage.sql.exec('SELECT payload, blob_ids FROM workflows')][0]!;
            expect(String(row.payload)).not.toContain('private-text-');
            expect(String(row.payload).length).toBeLessThan(512 * 1024);
            expect(JSON.parse(String(row.blob_ids))).toHaveLength(1);
            expect((await artifacts.usage()).bytes).toBeGreaterThan(512 * 1024);
        }
    });
}
it('lists this month tasks without profileId and preserves false, filtered pagination and encrypted large read state', async () => {
    const request = vi.fn(async (input: ApiRequest): Promise<JsonObject> => {
        expect(input.path).toBe('/open-apis/task/v2/tasks');
        expect(input.query).toMatchObject({ completed: 'false', type: 'my_tasks' });
        const page = Number(input.query?.page_token || 0);
        if (!page) return { items: [{ guid: 'outside', summary: 'Outside', due: { timestamp: String(Date.parse('2026-11-01')) } }], has_more: true, page_token: '1' };
        return { items: Array.from({ length: 40 }, (_, i) => ({ guid: `task-${(page - 1) * 40 + i}`, summary: `Task ${i} ${'private-text-'.repeat(400)}`, completed_at: '0', due: { timestamp: String(Date.parse('2026-10-31T23:59:59Z')) } })), has_more: page < 4, page_token: page < 4 ? String(page + 1) : '' };
    });
    await fixture('tasks', { request }, async ({ dispatcher, complete }) => {
        const readGrant: Grant = { ...grant, domains: ['task', 'workflow'], permissions: ['read'] };
        const args = { complete: false, 'due-start': '2026-10-01', 'due-end': '2026-10-31', 'page-all': true };
        await call(dispatcher, 'task.+get-my-tasks', args, readGrant, true);
        expect(request).not.toHaveBeenCalled();
        const result = await complete('task.+get-my-tasks', args, readGrant);
        expect(result.items).toHaveLength(160); expect((result.items as JsonObject[])[159]).toMatchObject({ guid: 'task-159', completed: false, due_at: '2026-10-31T23:59:59Z' });
        expect(request).toHaveBeenCalledTimes(5);
    });
});
it('creates Markdown documents through async MCP workflow without repeating the initial write', async () => {
    const request = vi.fn().mockResolvedValueOnce({ task: { task_id: 'created', status: 'processing' } }).mockResolvedValueOnce({ task: { task_id: 'created', status: 'succeeded', result: { create_document: JSON.stringify({ document: { document_id: 'doc' } }) } } });
    await fixture('docs', { request, brand: 'lark' }, async ({ dispatcher, complete }) => {
        const args = { title: 'Monthly report', content: '# Report\n\nReady.', 'doc-format': 'markdown' };
        await call(dispatcher, 'docs.+create', args, grant, true); expect(request).not.toHaveBeenCalled();
        const output = await complete('docs.+create', args);
        expect(output).toMatchObject({ document: { document_id: 'doc', url: 'https://www.larksuite.com/docx/doc' } }); expect(request.mock.calls.filter(([input]) => input.method === 'POST')).toHaveLength(1);
        expect(request.mock.calls[0]![0].body).toMatchObject({ format: 'markdown', content: '<title>Monthly report</title>\n# Report\n\nReady.' });
    });
});
it('imports a private artifact and exports Wiki documents with durable virtual-clock polling', async () => {
    let polls = 0;
    const request = vi.fn(async (input: ApiRequest): Promise<JsonObject> => {
        if (input.path.endsWith('/import_tasks') && input.method === 'POST') return { ticket: 'import-ticket' };
        if (input.path.endsWith('/import_tasks/import-ticket')) return { result: { job_status: 0, token: 'imported', type: 'docx' } };
        if (input.path.includes('/wiki/')) return { node: { obj_token: 'imported', obj_type: 'docx' } };
        if (input.path.endsWith('/export_tasks')) return { ticket: 'export-ticket' };
        if (input.path.endsWith('/export_tasks/export-ticket')) return { result: ++polls === 1 ? { job_status: 2 } : { job_status: 0, file_token: 'exported', file_name: 'Report' } };
        throw new Error(`Unexpected path ${input.path}`);
    });
    const upload = vi.fn(async (input: UploadRequest): Promise<JsonObject> => { expect(await input.file.body.text()).toBe('# Source'); return { file_token: 'media' }; });
    const download = vi.fn(async () => new Response('PDF', { headers: { 'Content-Length': '3' } }));
    await fixture('drive', { request, upload, download }, async ({ dispatcher, artifacts, advance, complete }) => {
        const blob = new Blob(['# Source']); const source = await artifacts.upload(grant.id, blob.size, blob.stream());
        expect(await complete('drive.+import', { file: source.id, 'file-name': 'source.md', type: 'docx' })).toMatchObject({ token: 'imported', ready: true });
        expect(upload).toHaveBeenCalledOnce();
        let result = await call(dispatcher, 'drive.+export', { url: 'https://example.test/wiki/wiki', 'file-extension': 'pdf' });
        for (let i = 0; !result.retryAfter && i < 20; i++) result = await call(dispatcher, 'workflow.resume', { id: result.workflowId });
        expect(result.retryAfter).toBe(2000); const calls = request.mock.calls.length;
        expect(await call(dispatcher, 'workflow.resume', { id: result.workflowId })).toMatchObject({ retryAfter: 2000 }); expect(request).toHaveBeenCalledTimes(calls);
        advance(2000);
        for (let i = 0; result.status === 'pending' && i < 20; i++) result = await call(dispatcher, 'workflow.resume', { id: result.workflowId });
        expect(result.status).toBe('completed'); const output = result.output as JsonObject;
        expect(output).toMatchObject({ filename: 'Report.pdf', size_bytes: 3 }); expect(new TextDecoder().decode(await (await artifacts.read(grant.id, String(output.artifact_id))).arrayBuffer())).toBe('PDF');
        expect(polls).toBe(2);
    });
});
it('projects Wiki details and stores native Markdown content in private R2', async () => {
    const request = vi.fn(async (): Promise<JsonObject> => ({ node: { node_token: 'wiki', obj_token: 'doc', obj_type: 'docx', node_creator: 'ou_author', obj_edit_time: '1700000000' } }));
    const download = vi.fn(async () => new Response('# Notes', { headers: { 'Content-Length': '7', 'Content-Disposition': 'attachment; filename="notes.md"' } }));
    await fixture('wiki-markdown', { request, download }, async ({ artifacts, complete }) => {
        expect(await complete('wiki.+node-get', { 'node-token': 'wiki' })).toMatchObject({ creator: 'ou_author', updated_at: '2023-11-14T22:13:20Z' });
        const output = await complete('markdown.+fetch', { 'file-token': 'file', output: 'notes.md' });
        expect(output).toMatchObject({ file_name: 'notes.md', size_bytes: 7 });
        expect(new TextDecoder().decode(await (await artifacts.read(grant.id, String(output.artifact_id))).arrayBuffer())).toBe('# Notes');
        expect(download).toHaveBeenCalledExactlyOnceWith({ path: '/open-apis/drive/v1/medias/file/preview_download', query: { preview_type: '16' } });
    });
});
it('filters OKR cycles while preserving the upstream continuation cursor', async () => {
    const request = vi.fn(async (): Promise<JsonObject> => ({ items: [{ id: '1', start_time: String(Date.parse('2026-10-01')), end_time: String(Date.parse('2026-10-31')), cycle_status: 1 }, { id: '2', start_time: '0', end_time: '1000' }], has_more: true, page_token: 'next' }));
    await fixture('okr', { request }, async ({ complete }) => {
        const output = await complete('okr.+cycle-list', { 'user-id': 'ou_me', 'time-range': '2026-10--2026-10', 'page-size': 10 });
        expect(output.cycles).toHaveLength(1); expect(output.page_token).toBe('next'); expect(request).toHaveBeenCalledOnce();
    });
});

import { CloudflareContentHasher } from '../../src/infrastructure/crypto/content-hasher';
import { documentParser, imCardFormatter, baseRecordFormatter, mailTransformer } from '../../src/infrastructure/documents/adapter';
import { HttpRemoteFiles } from '../../src/infrastructure/http/remote-files';
import { createWorkflowPrograms } from '../../src/capabilities/programs';
import { createCapabilities } from '../../src/capabilities/catalog';
import { WorkflowService } from '../../src/application/workflows';
import { fixtureFiles, fixtureWorkflows } from './file-workflow-fixtures';
import { mcpResponse } from '../../src/adapters/mcp/handler';
import { Dispatcher } from '../../src/application/dispatcher';
import { Registry } from '../../src/capabilities/registry';
import type { Grant } from '../../src/domain/models';
import { SchemaValidator } from '../../src/infrastructure/validation/schema-validator';
import { LarkHttpClient } from '../../src/infrastructure/lark/http-client';

export default {
    async fetch(request: Request): Promise<Response> {
        if (new URL(request.url).pathname === '/health') return new Response('Local test fixture');
        const calls: Array<{ method: string; path: string; body: unknown }> = [];
        let requests = 0;
        let tokens = 0;
        let uploaded: string | undefined;
        const createClient = async () => new LarkHttpClient('feishu', async () => { tokens++; return 'local-test-token'; }, async (upstream) => {
            requests++;
            if (upstream.headers.get('Content-Type')?.startsWith('multipart/form-data')) {
                const form = await upstream.formData();
                const file = form.get('file') as File;
                uploaded = btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer())));
                return Response.json({ code: 0, data: { file_token: 'fixture-upload' } });
            }
            const body = await upstream.text();
            if (request.headers.get('X-Fixture-Scenario') === 'shortcuts') {
                const path = new URL(upstream.url).pathname;
                calls.push({ method: upstream.method, path, body: body ? JSON.parse(body) : null });
                if (path === '/open-apis/im/v1/messages') return Response.json({ code: 0, data: { message_id: 'om_fixture', chat_id: 'oc_fixture', create_time: '1700000000000' } });
                if (path === '/open-apis/authen/v1/user_info') return Response.json({ code: 0, data: { open_id: 'ou_fixture' } });
            }
            if (request.headers.get('X-Fixture-Scenario') === 'domains') {
                const path = new URL(upstream.url).pathname;
                if (path.startsWith('/open-apis/application/v7/app_slash_commands')) return Response.json({ code: 0, data:
                    upstream.method === 'GET' ? { items: [{ command: 'fixture', command_id: 'fixture-id' }] } : { command_id: 'fixture-id' } });
                if (path.endsWith('/users/search')) return Response.json({ code: 0, data: { items: [{ id: 'ou_fixture', meta_data: {} }], has_more: false } });
                if (path === '/open-apis/bot/v4/bot/search') return Response.json({ code: 0, data: { items: [{ id: 'ou_bot', display_info: '<h>Fixture &amp; Bot</h>' }] } });
                if (path === '/open-apis/authen/v1/user_info') return Response.json({ code: 0, data: { open_id: 'ou_fixture' } });
                if (path.startsWith('/open-apis/contact/v3/users/')) return Response.json({ code: 0, data: { user: { open_id: 'ou_fixture' } } });
            }
            if (new URL(upstream.url).pathname === '/open-apis/docs_ai/v1/documents') return Response.json({ code: 0, data: { document: { document_id: 'fixture-doc' } } });
            return Response.json({ code: 0, data: { method: upstream.method, url: upstream.url, body: body ? JSON.parse(body) : null } });
        });
        const remoteFiles = new HttpRemoteFiles();
        const workflows = new WorkflowService(fixtureWorkflows, createWorkflowPrograms({ artifacts: fixtureFiles, remoteFiles, cardFormatter: imCardFormatter, recordFormatter: baseRecordFormatter, events: { read: async (_profile, cursor) => ({ events: [], cursor }) }, hasher: new CloudflareContentHasher(), mailTransformer }), createClient);
        const registry = new Registry(createCapabilities({ recordFormatter: baseRecordFormatter, mailTransformer, documentParser, remoteFiles, artifacts: fixtureFiles, workflows, events: { read: async (_profile, cursor) => ({ events: [], cursor }) } }));
        const grant: Grant = { id: 'fixture', expiresAt: Date.now() + 60_000, revoked: false,
            profiles: [{ profileId: 'fixture-profile', accounts: ['fixture-account'], identities: ['user', 'bot'] }],
            domains: [...new Set(registry.list().map((command) => command.definition.domain))], permissions: ['read', 'write'] };
        const dispatcher = new Dispatcher(registry, new SchemaValidator(), createClient);
        const response = await mcpResponse(request, dispatcher, grant);
        const result = new Response(response.body, response);
        if (uploaded) result.headers.set('X-Fixture-Upload', uploaded);
        if (request.headers.get('X-Fixture-Scenario') === 'shortcuts') result.headers.set('X-Fixture-Calls', JSON.stringify(calls));
        result.headers.set('X-Fixture-Requests', String(requests));
        result.headers.set('X-Fixture-Tokens', String(tokens));
        return result;
    },
};

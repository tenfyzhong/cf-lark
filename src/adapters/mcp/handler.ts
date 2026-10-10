import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { Dispatcher } from '../../application/dispatcher';
import type { Grant } from '../../domain/models';
import { safeError } from '../../domain/errors';

export async function mcpResponse(request: Request, dispatcher: Dispatcher, grant: Grant): Promise<Response> {
    const server = new McpServer({ name: 'cf-lark', version: '0.1.0' });
    const respond = async (tool: string, run: () => unknown) => {
        try {
            const value = await run();
            return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
        } catch (error) {
            const failure = safeError(error);
            console.warn(JSON.stringify({ event: 'mcp_tool_error', tool, code: failure.code }));
            return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(failure) }] };
        }
    };
    server.registerResource('agent-guidance-v1', new ResourceTemplate('cf-lark://guidance/v1/{+path}', {
        list: async () => ({ resources: dispatcher.guidanceResources(grant) }),
    }), { description: 'Versioned grant-filtered agent skills, workflow/artifact/watch references and hosted resource limits.', mimeType: 'application/json' }, async uri => ({
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(dispatcher.readGuidance(uri.href, grant)) }],
    }));
    server.registerTool('lark_search', {
        description: 'Search commands available to this authorization grant using English keywords, curated synonyms or common Chinese phrases. Versioned agent skills and references are available through MCP resources; search results include guidance links. Check authorization permissions and domains when results are missing; writes require mcp:write and renewed consent. Results include executionContext with authorized profileId and accountId choices; use these IDs instead of asking the user to find configuration IDs.',
        inputSchema: { query: z.string(), domain: z.string().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
        annotations: { readOnlyHint: true, destructiveHint: false },
    }, (input) => respond('lark_search', () => dispatcher.search(input, grant)));
    server.registerTool('lark_schema', {
        description: 'Read a command schema, identity requirements, scopes, affordances, guidance references and authorized executionContext before execution.',
        inputSchema: { command: z.string() },
        annotations: { readOnlyHint: true, destructiveHint: false },
    }, (input) => respond('lark_schema', () => dispatcher.schema(input.command, grant)));
    server.registerTool('lark_execute', {
        description: 'Execute a selected Lark command or preview it with dryRun. Fetch lark_schema first: shortcut commands such as docs.+create and im.+messages-send accept flat flag names, while API commands use params/body. Use user identity for personal tasks and bot for application actions. Omit profileId/accountId when only one authorized choice exists; otherwise use executionContext from lark_search or lark_schema. Commands may modify upstream data.',
        inputSchema: {
            command: z.string(), args: z.record(z.string(), z.unknown()), profileId: z.string().optional(),
            accountId: z.string().optional(), identity: z.enum(['user', 'bot']), dryRun: z.boolean().optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, (input) => respond('lark_execute', () => dispatcher.execute(input, grant)));
    server.registerTool('lark_auth_diagnose', {
        description: 'Inspect grant-scoped local authorization metadata without an upstream call. Diagnose command domain/write/identity restrictions, token expiry and catalog scope hints. App scope and resource access remain unknown unless independently verified. Never returns credentials or refreshes a token.',
        inputSchema: { identity: z.enum(['user', 'bot']), profileId: z.string().optional(), accountId: z.string().optional(), command: z.string().optional() },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, (input) => respond('lark_auth_diagnose', () => dispatcher.diagnoseAuth(input, grant)));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
}

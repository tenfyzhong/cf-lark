import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
    server.registerTool('lark_search', {
        description: 'Search commands available to this authorization grant using English keywords. Check authorization permissions and domains when results are missing; writes require mcp:write and renewed consent. Results include executionContext with authorized profileId and accountId choices; use these IDs instead of asking the user to find configuration IDs.',
        inputSchema: { query: z.string(), domain: z.string().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
        annotations: { readOnlyHint: true, destructiveHint: false },
    }, (input) => respond('lark_search', () => dispatcher.search(input, grant)));
    server.registerTool('lark_schema', {
        description: 'Read a command schema, identity requirements, scopes and authorized executionContext before execution.',
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
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
}

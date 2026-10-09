import { readRequestBody } from '@modelcontextprotocol/sdk/server/requestBody.js';
import { matchesCommand } from '../../domain/command-search';
import { insufficientScope, type OAuthResourceAuth } from '@cloudflare/workers-oauth-provider';
import type { JsonObject } from '../../domain/models';
import type { CapabilityRegistry, InputValidator } from '../../ports/capabilities';

export async function writeScopeChallenge(request: Request, auth: OAuthResourceAuth, registry: CapabilityRegistry, validator?: InputValidator): Promise<Response | undefined> {
    if (request.method !== 'POST' || auth.scope.includes('mcp:write')) return;
    let body;
    try {
        const cloned = request.clone();
        const input = await readRequestBody(cloned as unknown as Parameters<typeof readRequestBody>[0], 4 * 1024 * 1024);
        if (input.tooLarge) {
            void cloned.body?.cancel().catch(() => {});
            void request.body?.cancel().catch(() => {});
            return Response.json({ error: 'request_too_large', error_description: 'MCP request body must not exceed 4 MiB.' }, { status: 413 });
        }
        body = JSON.parse(input.text) as { method?: string; params?: { name?: string; arguments?: { command?: unknown; query?: unknown; domain?: unknown; args?: unknown } } }; }
    catch { return; }
    if (!body || body.method !== 'tools/call') return;
    const args = body.params?.arguments;
    if (body.params?.name === 'lark_search') {
        if (typeof args?.query !== 'string' || !args.query.trim() || (args.domain !== undefined && typeof args.domain !== 'string')) return;
        const query = { query: args.query, domain: args.domain as string | undefined };
        const matches = registry.list().filter((item) => matchesCommand(item.definition, query));
        if (!matches.length || matches.some((item) => item.risk || item.definition.risk !== 'write')) return;
    } else {
        if (!['lark_execute', 'lark_schema'].includes(body.params?.name ?? '')) return;
        if (typeof args?.command !== 'string') return;
        const command = registry.get(args.command);
        if (!command) return;
        if (command.risk) {
            if (body.params?.name !== 'lark_execute' || !validator || !args.args || typeof args.args !== 'object' || Array.isArray(args.args)) return;
            try {
                const normalized = command.normalize ? command.normalize(args.args as JsonObject) : args.args as JsonObject;
                validator.validate(command.definition.inputSchema, normalized);
                if (command.risk(normalized) !== 'write') return;
            } catch { return; }
        } else if (command.definition.risk !== 'write') return;
    }
    return insufficientScope(auth, ['mcp:read', 'mcp:write'], 'This operation requires write access. Authorize the write scope and the command domain in a new consent request.');
}

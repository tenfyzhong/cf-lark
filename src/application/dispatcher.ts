import { commandAffordance, guidanceLinks, guidanceResources, readGuidance } from './agent-guidance';
import { AuthDiagnosticService, type AuthDiagnosticInput } from './auth-diagnostics';
import type { AuthorizationInspector } from '../ports/auth-diagnostics';
import { matchesCommand } from '../domain/command-search';
import { executionContext, resolveSelection, type SelectionInput } from '../domain/execution-selection';
import { authorize } from '../domain/authorization';
import { ServiceError } from '../domain/errors';
import type { ExecutionSelection, Grant, JsonObject } from '../domain/models';
import type { Capability, CapabilityRegistry, InputValidator } from '../ports/capabilities';
import type { LarkClient } from '../ports/lark';

export interface ExecuteInput extends SelectionInput {
    command: string;
    args: JsonObject;
    dryRun?: boolean;
}

export class Dispatcher {
    constructor(
        private readonly registry: CapabilityRegistry,
        private readonly validator: InputValidator,
        private readonly createClient: (selection: ExecutionSelection) => Promise<LarkClient>,
        private readonly now: () => number = Date.now,
        private readonly authorizationInspector?: AuthorizationInspector,
    ) {}

    diagnoseAuth(input: AuthDiagnosticInput, grant: Grant) {
        return new AuthDiagnosticService(this.registry, this.authorizationInspector, this.now).diagnose(input, grant);
    }

    private visible(capability: Capability, grant: Grant): boolean {
        const command = capability.definition;
        return !grant.revoked && grant.expiresAt > this.now()
            && grant.domains.includes(command.domain) && (capability.risk ? grant.permissions.length > 0 : grant.permissions.includes(command.risk))
            && grant.profiles.some((profile) => profile.identities.some((identity) => command.identities.includes(identity)));
    }

    private guidanceCommands(grant: Grant): readonly Capability[] {
        if (grant.revoked || grant.expiresAt <= this.now()) throw new ServiceError('GRANT_EXPIRED', 'Authorization has expired.', 401);
        return this.registry.list().filter(command => this.visible(command, grant));
    }

    guidanceResources(grant: Grant) { return guidanceResources(this.guidanceCommands(grant)); }

    readGuidance(uri: string, grant: Grant) { return readGuidance(uri, this.guidanceCommands(grant)); }

    search(input: { query: string; domain?: string; cursor?: string; limit?: number }, grant: Grant) {
        if (grant.revoked || grant.expiresAt <= this.now()) throw new ServiceError('GRANT_EXPIRED', 'Authorization has expired.', 401);
        const limit = input.limit ?? 20;
        const offset = input.cursor === undefined ? 0 : Number(input.cursor);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) {
            throw new ServiceError('INVALID_PAGINATION', 'Invalid catalog pagination.');
        }
        const results = this.registry.list().filter((item) =>
            this.visible(item, grant) && matchesCommand(item.definition, input)).map((item) => item.definition);
        return {
            guidance: guidanceLinks(this.guidanceCommands(grant)),
            executionContext: executionContext(grant),
            authorization: { domains: grant.domains, permissions: grant.permissions, writeAccess: grant.permissions.includes('write'),
                requiredWriteScope: 'mcp:write', guidance: 'Missing domains or write access require a new OAuth authorization with the desired domains and mcp:write scope.' },
            commands: results.slice(offset, offset + limit).map(({ inputSchema: _schema, ...summary }) => summary),
            ...(offset + limit < results.length ? { next_cursor: String(offset + limit) } : {}),
        };
    }

    schema(id: string, grant: Grant) {
        const command = this.resolve(id);
        if (!this.visible(command, grant)) throw new ServiceError('FORBIDDEN', 'This command is outside the authorization grant.', 403);
        const visible = this.guidanceCommands(grant);
        return { ...command.definition, ...(command.risk ? { riskByArguments: true } : {}), guidance: guidanceLinks(visible, command.definition), affordance: commandAffordance(command, visible), executionContext: executionContext(grant, command.definition.identities) };
    }

    private resolve(id: string): Capability {
        const command = this.registry.get(id);
        if (!command) throw new ServiceError('UNKNOWN_COMMAND', 'The command is not implemented.', 404);
        return command;
    }

    async execute(input: ExecuteInput, grant: Grant) {
        const command = this.resolve(input.command);
        const selection = resolveSelection(input, grant, command.definition.identities, this.now());
        authorize(grant, { ...selection, domain: command.definition.domain, risk: command.risk ? (grant.permissions[0] ?? 'read') : command.definition.risk }, this.now());
        const args = command.normalize ? command.normalize(input.args) : input.args;
        this.validator.validate(command.definition.inputSchema, args);
        if (command.risk) authorize(grant, { ...selection, domain: command.definition.domain, risk: command.risk(args) }, this.now());
        const data = input.dryRun
            ? await command.preview(args, { selection, grant })
            : await command.execute(args, { lark: await this.createClient(selection), selection, grant });
        return { ok: true as const, identity: selection.identity, selection, data, ...(input.dryRun ? { meta: { dry_run: true } } : {}) };
    }
}

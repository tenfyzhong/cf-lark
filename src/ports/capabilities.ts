import type { CommandDefinition, ExecutionSelection, Grant, JsonObject, Risk } from '../domain/models';
import type { LarkClient } from './lark';

export interface CommandContext {
    lark: LarkClient;
    selection: ExecutionSelection;
    grant: Grant;
}

export interface Capability {
    definition: CommandDefinition;
    risk?(args: JsonObject): Risk;
    normalize?(args: JsonObject): JsonObject;
    execute(args: JsonObject, context: CommandContext): Promise<unknown>;
    preview(args: JsonObject, context?: Pick<CommandContext, 'selection' | 'grant'>): Promise<unknown>;
}

export interface CapabilityRegistry {
    get(id: string): Capability | undefined;
    list(): readonly Capability[];
}

export interface InputValidator {
    validate(schema: JsonObject, input: unknown): void;
}

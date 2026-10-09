import { ServiceError } from '../domain/errors';
import type { Capability, CapabilityRegistry } from '../ports/capabilities';

export class Registry implements CapabilityRegistry {
    private readonly commands: ReadonlyMap<string, Capability>;

    constructor(capabilities: readonly Capability[]) {
        const commands = new Map<string, Capability>();
        for (const capability of capabilities) {
            if (commands.has(capability.definition.id)) throw new ServiceError('DUPLICATE_COMMAND', 'Duplicate command registration.', 500);
            commands.set(capability.definition.id, capability);
        }
        this.commands = commands;
    }

    get(id: string): Capability | undefined { return this.commands.get(id); }
    list(): readonly Capability[] { return [...this.commands.values()]; }
}

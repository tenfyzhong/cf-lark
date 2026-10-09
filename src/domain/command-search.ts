import type { CommandDefinition } from './models';

export function matchesCommand(definition: CommandDefinition, input: { query: string; domain?: string }): boolean {
    const terms = input.query.toLowerCase().split(/\s+/u).filter(Boolean);
    return (!input.domain || definition.domain === input.domain)
        && terms.every((term) => `${definition.id} ${definition.description}`.toLowerCase().includes(term));
}

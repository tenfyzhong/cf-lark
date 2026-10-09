export interface ShortcutStatus {
    status: 'implemented' | 'partial' | 'excluded';
    exclusion?: { kind: 'local-runtime'; reason: string; sources: string[]; documentation: string };
    flags: string[];
    evidence: string[];
    adaptations: string[];
}
export function applyShortcutStatus<T extends { id: string; flags: string[]; status: string }>(
    commands: T[], statuses: Record<string, ShortcutStatus>, exists: (path: string) => boolean, sourceExists?: (path: string) => boolean,
): (Omit<T, 'status'> & { status: string; coveredFlags?: string[]; evidence?: string[]; adaptations?: string[]; exclusion?: ShortcutStatus['exclusion'] })[] {
    for (const id of Object.keys(statuses)) if (!commands.some((command) => command.id === id)) throw new Error(`Unknown shortcut status: ${id}`);
    return commands.map((command) => {
        const status = statuses[command.id];
        if (!status) return command;
        if (!['implemented', 'partial', 'excluded'].includes(status.status)) throw new Error(`Invalid shortcut status: ${command.id}`);
        if (!status.evidence.length || status.evidence.some((path) => !path.startsWith('test/') || !exists(path))) throw new Error(`Missing test evidence: ${command.id}`);
        if (status.status === 'excluded') {
            const exclusion = status.exclusion;
            if (!exclusion || exclusion.kind !== 'local-runtime' || !exclusion.reason.trim() || !exclusion.sources.length
                || exclusion.sources.some(path => !/^shortcuts\/[a-z_]+\/[a-z0-9_]+\.go$/.test(path))
                || !/^docs\/[a-z0-9-]+\.md$/.test(exclusion.documentation) || !exists(exclusion.documentation) || status.flags.length)
                throw new Error(`Invalid local-runtime exclusion: ${command.id}`);
            if (sourceExists && exclusion.sources.some(path => !sourceExists(path))) throw new Error(`Missing pinned exclusion source: ${command.id}`);
        } else if (status.exclusion) throw new Error(`Unexpected exclusion metadata: ${command.id}`);
        if (new Set(status.flags).size !== status.flags.length || status.flags.some((flag) => !command.flags.includes(flag))
            || (status.status === 'implemented' && command.flags.some((flag) => !status.flags.includes(flag)))) throw new Error(`Incomplete or unknown flags: ${command.id}`);
        return { ...command, status: status.status, coveredFlags: status.flags, evidence: status.evidence, adaptations: status.adaptations, ...(status.exclusion ? { exclusion: status.exclusion } : {}) };
    });
}

export function mergeShortcutStatuses(fragments: Record<string, ShortcutStatus>[]): Record<string, ShortcutStatus> {
    const result: Record<string, ShortcutStatus> = {};
    for (const fragment of fragments) for (const [id, entry] of Object.entries(fragment)) {
        if (Object.hasOwn(result, id)) throw new Error(`Duplicate shortcut status ownership: ${id}`);
        result[id] = entry;
    }
    return result;
}

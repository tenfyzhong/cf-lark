import type { JsonObject } from '../../domain/models';
import { chartInvalid } from './chart-input';
function targets(entries: JsonObject[]): JsonObject[] {
    return entries.filter(entry => ['chart-config-update', 'chart-data-update'].includes(String(entry.name))).map(entry => entry.args as JsonObject);
}
export function chartTargetsNeedLookup(entries: JsonObject[]): boolean {
    const kinds = new Map<string, Set<string>>();
    for (const args of targets(entries)) {
        const id = String(args['chart-id']), set = kinds.get(id) ?? new Set<string>();
        set.add(args['sheet-id'] ? 'id' : 'name'); kinds.set(id, set);
    }
    return [...kinds.values()].some(set => set.size > 1);
}
export function assertUniqueChartTargets(entries: JsonObject[], ids: Record<string, string> = {}): void {
    const seen = new Set<string>();
    for (const args of targets(entries)) {
        const name = String(args['sheet-name'] ?? '');
        const selector = args['sheet-id'] ? `id:${args['sheet-id']}` : ids[name] ? `id:${ids[name]}` : `name:${name}`;
        const key = JSON.stringify([selector, args['chart-id']]);
        if (seen.has(key)) chartInvalid('Chart batches contain duplicate chart targets.');
        seen.add(key);
    }
}

import { expect, it } from 'vitest';
import coverage from '../docs/generated/coverage.json';
it('keeps source inventory separate from command implementation status', () => {
    expect(coverage.shortcutSourceInventory.length).toBeGreaterThan(0);
    for (const entry of coverage.shortcutSourceInventory) {
        expect(Object.keys(entry).sort(), entry.file).toEqual(['domain', 'file']);
        expect(entry.file).toMatch(/^shortcuts\/[a-z_]+\/[a-z0-9_]+\.go$/);
        expect(entry.file).toContain(`/` + entry.domain + `/`);
    }
    expect(new Set(coverage.shortcutSourceInventory.map(item => item.file)).size).toBe(coverage.shortcutSourceInventory.length);
});
it('retains reviewed hosted command coverage and explicit local terminal exclusions', () => {
    expect(coverage.shortcutCommands.filter(item => item.status === 'implemented')).toHaveLength(531);
    expect(coverage.shortcutCommands.filter(item => item.status === 'excluded')).toHaveLength(7);
    expect(coverage.shortcutCommands.filter(item => !['implemented', 'excluded'].includes(item.status))).toEqual([]);
    expect(coverage.fullCompatibility).toBe(false);
});

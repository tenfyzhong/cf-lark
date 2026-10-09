import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('inventories upstream registered shortcuts instead of counting source files', () => {
    const coverage = JSON.parse(readFileSync('docs/generated/coverage.json', 'utf8'));
    expect(coverage.shortcutCommands).toHaveLength(538);
    const ids = coverage.shortcutCommands.map((entry: { id: string }) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('docs.+create');
    expect(ids).toContain('im.+messages-send');
    expect(coverage.fullCompatibility).toBe(false);
});

import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import coverage from '../docs/generated/coverage.json';
import statuses from '../scripts/catalog/apps-status.json';
import { appsDefinitions } from '../src/capabilities/apps/definitions';
import { applyShortcutStatus, type ShortcutStatus } from '../scripts/catalog/shortcut-status';
const expected = ['apps.+init', 'apps.+git-credential-init', 'apps.+git-credential-list', 'apps.+git-credential-remove', 'apps.+plugin-install', 'apps.+plugin-list', 'apps.+plugin-uninstall'].sort();
it('keeps exactly the source-documented local terminal commands outside the hosted registry', () => {
    const reviewed = statuses as Record<string, ShortcutStatus>;
    const excluded = Object.entries(reviewed).filter(([, value]) => value.status === 'excluded');
    expect(excluded.map(([id]) => id).sort()).toEqual(expected);
    const applied = applyShortcutStatus(coverage.shortcutCommands, reviewed, existsSync);
    const docs = readFileSync('docs/apps-shortcuts.md', 'utf8');
    for (const [id, value] of excluded) {
        expect(appsDefinitions.some(definition => definition.id === id), id).toBe(false);
        expect(applied.find(item => item.id === id)).toMatchObject({ status: 'excluded', coveredFlags: [], exclusion: value.exclusion });
        expect(docs).toContain(id); expect(docs).toContain(value.exclusion!.sources[0]);
        expect(value.exclusion!.reason.length).toBeGreaterThan(30);
    }
});

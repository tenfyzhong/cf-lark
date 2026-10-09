import { describe, expect, it } from 'vitest';
import { applyShortcutStatus, mergeShortcutStatuses } from '../scripts/catalog/shortcut-status';

describe('shortcut coverage evidence', () => {
    const commands = [{ id: 'domain.+command', flags: ['name', 'force'], status: 'pending' }];
    const entry = { status: 'implemented' as const, flags: ['name', 'force'], evidence: ['test/fixture.test.ts'], adaptations: [] };
    it('requires real evidence and full flag coverage before marking a command implemented', () => {
        expect(applyShortcutStatus(commands, { 'domain.+command': entry }, () => true)[0]).toMatchObject({ status: 'implemented', evidence: entry.evidence });
        expect(() => applyShortcutStatus(commands, { 'domain.+command': { ...entry, flags: ['name'] } }, () => true)).toThrow(/flags/u);
        expect(() => applyShortcutStatus(commands, { 'domain.+command': entry }, () => false)).toThrow(/evidence/u);
        expect(() => applyShortcutStatus(commands, { 'domain.+command': { ...entry, evidence: [] } }, () => true)).toThrow(/evidence/u);
    });
    it('rejects unknown commands and flags while preserving pending and partial states', () => {
        expect(applyShortcutStatus(commands, {}, () => true)[0]?.status).toBe('pending');
        expect(() => applyShortcutStatus(commands, { unknown: entry }, () => true)).toThrow(/Unknown/u);
        expect(() => applyShortcutStatus(commands, { 'domain.+command': { ...entry, flags: ['name', 'force', 'fiction'] } }, () => true)).toThrow(/flags/u);
        expect(applyShortcutStatus(commands, { 'domain.+command': { ...entry, status: 'partial', flags: ['name'] } }, () => true)[0]?.status).toBe('partial');
    });
});

it('merges domain status fragments without silently replacing evidence', () => {
    const entry = { status: 'partial' as const, flags: [], evidence: ['test/example.test.ts'], adaptations: [] };
    expect(mergeShortcutStatuses([{ 'one.+a': entry }, { 'two.+b': entry }])).toEqual({ 'one.+a': entry, 'two.+b': entry });
    expect(() => mergeShortcutStatuses([{ 'one.+a': entry }, { 'one.+a': entry }])).toThrow(/Duplicate/u);
});

it('classifies documented local-runtime exclusions without claiming implemented flags', () => {
    const exclusion = { kind: 'local-runtime' as const, reason: 'Requires the caller local Git credential helper.', sources: ['shortcuts/apps/git_credential.go'], documentation: 'docs/apps-shortcuts.md' };
    const entry = { status: 'excluded' as const, flags: [], evidence: ['test/apps-local-exclusions.test.ts'], adaptations: [], exclusion };
    const commands = [{ id: 'apps.+git-credential-init', flags: ['app-id'], status: 'pending' }];
    expect(applyShortcutStatus(commands, { 'apps.+git-credential-init': entry }, () => true)[0]).toMatchObject({ status: 'excluded', coveredFlags: [], exclusion });
    for (const invalid of [{ ...entry, exclusion: undefined }, { ...entry, flags: ['app-id'] }, { ...entry, exclusion: { ...exclusion, reason: '' } }, { ...entry, exclusion: { ...exclusion, sources: ['../escape.go'] } }]) {
        expect(() => applyShortcutStatus(commands, { 'apps.+git-credential-init': invalid } as never, () => true)).toThrow(/exclusion/i);
    }
    expect(() => applyShortcutStatus(commands, { 'apps.+git-credential-init': entry }, path => path.startsWith('test/'))).toThrow(/exclusion/i);
});
it('verifies exclusion source references against the pinned checkout during generation', () => {
    const commands = [{ id: 'apps.+init', flags: ['name'], status: 'pending' }];
    const entry = { status: 'excluded' as const, flags: [], evidence: ['test/apps-local-exclusions.test.ts'], adaptations: [], exclusion: { kind: 'local-runtime' as const, reason: 'Requires Git and the caller local checkout.', sources: ['shortcuts/apps/apps_init.go'], documentation: 'docs/apps-shortcuts.md' } };
    expect(() => applyShortcutStatus(commands, { 'apps.+init': entry }, () => true, () => false)).toThrow(/source/i);
    expect(applyShortcutStatus(commands, { 'apps.+init': entry }, () => true, path => path === 'shortcuts/apps/apps_init.go')[0]?.status).toBe('excluded');
});

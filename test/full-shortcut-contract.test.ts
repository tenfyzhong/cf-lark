import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import coverage from '../docs/generated/coverage.json';
import { createCapabilities } from '../src/capabilities/catalog';
import type { CommandDefinition } from '../src/domain/models';
const unavailable = async (): Promise<never> => { throw new Error('Catalog discovery must not execute a port.'); };
const capabilities = createCapabilities({ documentParser: { parse: unavailable }, events: { read: unavailable }, artifacts: { upload: unavailable, read: unavailable, remove: unavailable, stat: unavailable }, workflows: { start: unavailable, resume: unavailable } });
const registered = capabilities.map((capability) => capability.definition).filter((definition) => definition.source === 'shortcut');
const pinned = coverage.shortcutCommands;
// Additional hosted inputs require a command-specific documented adaptation.
const hostedFlags: Record<string, { flags: string[]; document: string }> = {
    'apps.+automation-update': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+cache-clear': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+db-data-import': { flags: ['name', 'yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+db-env-create': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+db-env-migrate': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+db-execute': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+db-recovery-apply': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+db-sync-create': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+db-sync-delete': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+db-sync-update': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+env-delete': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+env-pull': { flags: ['file'], document: 'docs/apps-shortcuts.md' },
    'apps.+file-delete': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+file-upload': { flags: ['name', 'content-type'], document: 'docs/apps-shortcuts.md' },
    'apps.+html-publish': { flags: ['name'], document: 'docs/apps-shortcuts.md' },
    'apps.+member-remove': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+openapi-key-delete': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+openapi-key-reset': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+role-delete': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'apps.+role-member-remove': { flags: ['yes'], document: 'docs/apps-shortcuts.md' },
    'base.+field-list': { flags: ['page-size'], document: 'docs/base-shortcuts.md' },
    'base.+field-search-options': { flags: ['page-size'], document: 'docs/base-shortcuts.md' },
    'base.+form-submit': { flags: ['artifactNames'], document: 'docs/base-shortcuts.md' },
    'base.+record-get': { flags: ['table', 'field'], document: 'docs/base-shortcuts.md' },
    'base.+record-list': { flags: ['table', 'field', 'view', 'page-size'], document: 'docs/base-shortcuts.md' },
    'base.+record-search': { flags: ['table', 'field', 'view', 'page-size'], document: 'docs/base-shortcuts.md' },
    'base.+record-share-link-create': { flags: ['record-ids'], document: 'docs/base-shortcuts.md' },
    'base.+record-upload-attachment': { flags: ['artifactNames'], document: 'docs/base-shortcuts.md' },
    'base.+table-copy': { flags: ['timeout'], document: 'docs/base-shortcuts.md' },
    'base.+table-list': { flags: ['page-size'], document: 'docs/base-shortcuts.md' },
    'base.+template-list': { flags: ['page-size'], document: 'docs/base-shortcuts.md' },
    'base.+template-search': { flags: ['page-size'], document: 'docs/base-shortcuts.md' },
    'base.+title-resolve': { flags: ['query', 'url'], document: 'docs/base-shortcuts.md' },
    'base.+url-resolve': { flags: ['query'], document: 'docs/base-shortcuts.md' },
    'base.+view-list': { flags: ['page-size'], document: 'docs/base-shortcuts.md' },
    'calendar.+join-event': { flags: ['share-token'], document: 'docs/calendar-shortcuts.md' },
    'docs.+media-upload': { flags: ['name'], document: 'docs/file-transfers.md' },
    'docs.+media-insert': { flags: ['clipboard-artifact'], document: 'docs/docs-shortcuts.md' },
    'docs.+resource-update': { flags: ['clipboard-artifact'], document: 'docs/docs-shortcuts.md' },
    'docs.+script': { flags: ['workspace'], document: 'docs/docs-shortcuts.md' },
    'drive.+import': { flags: ['file-name'], document: 'docs/drive-shortcuts.md' },
    'drive.+sync': { flags: ['conflict-decisions'], document: 'docs/drive-shortcuts.md' },
    'event.+subscribe': { flags: ['cursor', 'limit'], document: 'docs/meeting-event-shortcuts.md' },
    'im.+chat-members-list': { flags: ['limit'], document: 'docs/im-shortcuts.md' },
    'im.+chat-messages-list': { flags: ['limit', 'start-time', 'end-time', 'sort', 'sort-order'], document: 'docs/im-shortcuts.md' },
    'im.+message-read-users': { flags: ['limit'], document: 'docs/im-shortcuts.md' },
    'im.+messages-mget': { flags: ['message-id'], document: 'docs/im-shortcuts.md' },
    'im.+messages-read-status': { flags: ['message-id'], document: 'docs/im-shortcuts.md' },
    'im.+messages-search': { flags: ['limit', 'page-delay', 'keyword'], document: 'docs/im-shortcuts.md' },
    'im.+threads-messages-list': { flags: ['limit', 'thread-id', 'sort'], document: 'docs/im-shortcuts.md' },
    'mail.+watch': { flags: ['cursor', 'limit', 'stop'], document: 'docs/mail-shortcuts.md' },
    'minutes.+search': { flags: ['keyword'], document: 'docs/meeting-event-shortcuts.md' },
    'okr.+upload-image': { flags: ['name'], document: 'docs/okr-shortcuts.md' },
    'sheets.+batch-chart-create': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+batch-chart-update': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+batch-update': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cells-batch-clear': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cells-batch-set-style': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cells-clear': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cells-get': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cells-merge': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cells-replace': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cells-search': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cells-set': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cells-set-image': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cells-set-style': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cells-unmerge': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+changeset-get': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+chart-config-update': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+chart-create': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+chart-create-basic': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+chart-data-update': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+chart-delete': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+chart-list': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+chart-update': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cols-resize': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cond-format-create': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cond-format-delete': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cond-format-list': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cond-format-result-get': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+cond-format-update': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+csv-get': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+csv-put': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+dim-delete': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+dim-freeze': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+dim-group': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+dim-hide': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+dim-insert': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+dim-move': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+dim-ungroup': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+dim-unhide': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+dropdown-delete': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+dropdown-get': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+dropdown-set': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+dropdown-update': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+filter-create': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+filter-delete': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+filter-list': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+filter-update': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+filter-view-create': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+filter-view-delete': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+filter-view-list': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+filter-view-update': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+float-image-create': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+float-image-delete': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+float-image-update': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+float-image-list': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+formula-verify': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+history-list': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+history-revert': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+history-revert-status': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+pivot-create': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+pivot-delete': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+pivot-list': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+pivot-update': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+range-copy': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+range-fill': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+range-move': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+range-sort': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+revision-get': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+rows-resize': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sheet-copy': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sheet-create': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sheet-delete': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sheet-hide': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sheet-hide-gridline': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sheet-info': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sheet-list': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sheet-move': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sheet-rename': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sheet-set-tab-color': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sheet-show-gridline': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sheet-unhide': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sparkline-create': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sparkline-delete': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sparkline-list': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+sparkline-update': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+styles-put': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+table-get': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+table-put': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+workbook-export': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+workbook-import': { flags: ['file-name'], document: 'docs/sheets-shortcuts.md' },
    'sheets.+workbook-info': { flags: ['token'], document: 'docs/sheets-shortcuts.md' },
    'slides.+add-slide': { flags: ['presentation-id', 'presentation-token', 'token', 'presentation_id', 'xml-presentation-id', 'url'], document: 'docs/slides-shortcuts.md' },
    'slides.+delete-slide': { flags: ['presentation-id', 'presentation-token', 'token', 'presentation_id', 'xml-presentation-id', 'url'], document: 'docs/slides-shortcuts.md' },
    'slides.+history-list': { flags: ['presentation-id', 'presentation-token', 'token', 'presentation_id', 'xml-presentation-id', 'url'], document: 'docs/slides-shortcuts.md' },
    'slides.+history-revert': { flags: ['presentation-id', 'presentation-token', 'token', 'presentation_id', 'xml-presentation-id', 'url'], document: 'docs/slides-shortcuts.md' },
    'slides.+history-revert-status': { flags: ['presentation-id', 'presentation-token', 'token', 'presentation_id', 'xml-presentation-id', 'url'], document: 'docs/slides-shortcuts.md' },
    'slides.+media-upload': { flags: ['presentation-id', 'presentation-token', 'token', 'presentation_id', 'xml-presentation-id', 'url'], document: 'docs/slides-shortcuts.md' },
    'slides.+replace-pages': { flags: ['presentation-id', 'presentation-token', 'token', 'presentation_id', 'xml-presentation-id', 'url'], document: 'docs/slides-shortcuts.md' },
    'slides.+replace-slide': { flags: ['presentation-id', 'presentation-token', 'token', 'presentation_id', 'xml-presentation-id', 'url'], document: 'docs/slides-shortcuts.md' },
    'slides.+screenshot': { flags: ['presentation-id', 'presentation-token', 'token', 'presentation_id', 'xml-presentation-id', 'url', 'slide-ids', 'slides', 'slide-numbers'], document: 'docs/slides-shortcuts.md' },
    'slides.+update': { flags: ['presentation-id', 'presentation-token', 'token', 'presentation_id', 'xml-presentation-id', 'url', 'xml', 'slide-xml', 'slide-content', 'content-xml'], document: 'docs/slides-shortcuts.md' },
    'slides.+update-slide': { flags: ['presentation-id', 'presentation-token', 'token', 'presentation_id', 'xml-presentation-id', 'url', 'xml', 'slide-xml', 'slide-content', 'content-xml'], document: 'docs/slides-shortcuts.md' },
    'slides.+xml-get': { flags: ['presentation-id', 'presentation-token', 'token', 'presentation_id', 'xml-presentation-id', 'url'], document: 'docs/slides-shortcuts.md' },
    'task.+upload-attachment': { flags: ['name'], document: 'docs/task-shortcuts.md' },
};
function flags(definition: CommandDefinition): string[] { return Object.keys(definition.inputSchema.properties as object || {}); }
const sorted = (values: readonly string[]) => [...new Set(values)].sort();
function mismatches() {
    const failures: { id: string; field: string; expected: unknown; actual: unknown }[] = [];
    for (const definition of registered) {
        const source = pinned.find((item) => item.id === definition.id);
        if (!source) { failures.push({ id: definition.id, field: 'inventory', expected: 'Pinned shortcut', actual: 'Unrecognized registration' }); continue; }
        for (const [field, expected, actual] of [
            ['identities', sorted(source.identities), sorted(definition.identities)],
            ['scopes', sorted([...(source.userScopes || []), ...(source.botScopes || [])]), sorted(definition.scopes)],
            ['missingFlags', [], source.flags.filter((flag) => !flags(definition).includes(flag))],
            ['undocumentedHostedFlags', [], flags(definition).filter((flag) => !source.flags.includes(flag) && !hostedFlags[definition.id]?.flags.includes(flag))],
        ] as [string, unknown, unknown][]) if (JSON.stringify(expected) !== JSON.stringify(actual)) failures.push({ id: definition.id, field, expected, actual });
    }
    return failures;
}
describe('Full pinned shortcut catalog contract', () => {
    it('preserves every registered shortcut identity, scope and upstream flag', () => { expect(mismatches()).toEqual([]); });
    it('registers every implemented inventory command exactly once', () => {
        const failures = pinned.filter((source) => source.status === 'implemented').flatMap((source) => { const count = registered.filter((definition) => definition.id === source.id).length; return count === 1 ? [] : [{ id: source.id, registrations: count }]; });
        expect(failures).toEqual([]);
        expect(new Set(registered.map((definition) => definition.id)).size).toBe(registered.length);
    });
    it('keeps every hosted-only flag adaptation specific and nonempty', () => {
        for (const [id, adaptation] of Object.entries(hostedFlags)) {
            const definition = registered.find((item) => item.id === id);
            expect(definition, id).toBeDefined(); expect(adaptation.document).toMatch(/^docs\/.+\.md$/); expect(adaptation.flags.length).toBeGreaterThan(0);
            expect(flags(definition!), id).toEqual(expect.arrayContaining(adaptation.flags));
            expect(readFileSync(new URL(`../${adaptation.document}`, import.meta.url), 'utf8').trim().length, adaptation.document).toBeGreaterThan(0);
            const source = pinned.find((item) => item.id === id)!;
            expect(adaptation.flags.filter((flag) => source.flags.includes(flag)), id).toEqual([]);
        }
    });
});

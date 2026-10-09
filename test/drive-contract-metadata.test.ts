import { describe, it, expect } from 'vitest';
import coverage from '../docs/generated/coverage.json';
import { allDriveDefinitions } from '../src/capabilities/drive/index';
import { wikiDefinitions } from '../src/capabilities/wiki/definitions';
import { markdownDefinitions } from '../src/capabilities/markdown/definitions';
describe('Drive, Wiki and Markdown pinned shortcut metadata', () => {
    for (const definition of [...allDriveDefinitions, ...wikiDefinitions, ...markdownDefinitions]) it(`${definition.id} preserves upstream flags, identities and declared scopes`, () => {
        const pinned = coverage.shortcutCommands.find((row) => row.id === definition.id)!;
        expect(Object.keys(definition.inputSchema.properties as object)).toEqual(expect.arrayContaining(pinned.flags));
        expect([...definition.identities].sort()).toEqual([...pinned.identities].sort());
        expect([...definition.scopes].sort()).toEqual([...new Set([...(pinned.userScopes || []), ...(pinned.botScopes || [])])].sort());
    });
});

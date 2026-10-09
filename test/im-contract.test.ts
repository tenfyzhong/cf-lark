import { expect, it } from 'vitest';
import { imDefinitions } from '../src/capabilities/im/definitions';
import coverage from '../docs/generated/coverage.json';
it('covers every pinned IM flag, identity and effective scope in command metadata', () => {
    const upstream = coverage.shortcutCommands.filter(command => command.id.startsWith('im.+'));
    expect(imDefinitions).toHaveLength(upstream.length);
    for (const expected of upstream) {
        const actual = imDefinitions.find(command => command.id === expected.id)!;
        expect(actual, expected.id).toBeTruthy();
        for (const flag of expected.flags) expect(actual.inputSchema.properties, `${expected.id}:${flag}`).toHaveProperty(flag);
        expect([...actual.identities].sort(), expected.id).toEqual([...expected.identities].sort());
        expect([...actual.scopes].sort(), expected.id).toEqual([...new Set([...(expected.userScopes ?? []), ...(expected.botScopes ?? [])])].sort());
    }
});

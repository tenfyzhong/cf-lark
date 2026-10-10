import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import descriptors from '../src/capabilities/api/generated/catalog.json';
import { commandDefinitions } from '../src/capabilities/definitions';
import { digestContract } from '../scripts/catalog/upstream-contract';

it('pins the current typed API schema and hosted shortcut set independently of live acceptance', () => {
    const pin = JSON.parse(readFileSync('test/fixtures/upstream/contracts.json', 'utf8'));
    expect(pin.commit).toBe('9067ec079bfa0b1ae2266cd91d1c1ee4a1ce824d');
    expect(digestContract(descriptors)).toBe(pin.apiDescriptorSha256);
    const hosted = commandDefinitions.filter(item => item.source === 'shortcut').map(item => item.id).sort();
    expect(hosted).toEqual(pin.hostedShortcutIds);
    expect(pin.liveAcceptance).toBe(false);
    expect(Object.keys(pin.sourceSha256).length).toBeGreaterThan(25);
});

it('makes object key ordering immaterial but preserves array order in schema contracts', () => {
    expect(digestContract({ a: 1, b: [2, 3] })).toBe(digestContract({ b: [2, 3], a: 1 }));
    expect(digestContract({ a: [2, 3] })).not.toBe(digestContract({ a: [3, 2] }));
});

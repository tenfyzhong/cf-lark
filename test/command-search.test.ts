import { describe, expect, it } from 'vitest';
import { matchesCommand } from '../src/domain/command-search';
import type { CommandDefinition } from '../src/domain/models';

const command = (id: string, description: string): CommandDefinition => ({
    id, description, domain: id.split('.')[0]!, inputSchema: {}, identities: ['user'], scopes: [], risk: 'read', source: 'shortcut',
});
const docs = command('docs.+create', 'Create a document from Markdown.');
const messages = command('im.+messages-search', 'Search messages with bounded pagination.');

describe('multilingual command discovery', () => {
    it.each([
        ['\u521b\u5efa\u6587\u6863', docs],
        ['\u641c\u7d22\u6d88\u606f', messages],
        ['\u641c\u7d22 messages', messages],
        ['find messages', messages],
        ['make document', docs],
        ['spreadsheet read', command('sheets.+read', 'Read cells.')],
        ['\u7ee7\u7eed\u5de5\u4f5c\u6d41', command('workflow.resume', 'Advance a pending workflow.')],
        ['\u4e0a\u4f20\u6587\u4ef6', command('artifact.upload', 'Upload a private artifact file.')],
    ])('matches curated aliases in %s', (query, definition) => {
        expect(matchesCommand(definition, { query })).toBe(true);
    });
    it('normalizes domain aliases without broadening the domain constraint', () => {
        expect(matchesCommand(docs, { query: '', domain: '\u6587\u6863' })).toBe(true);
        expect(matchesCommand(messages, { query: '', domain: 'chat' })).toBe(true);
        expect(matchesCommand(messages, { query: '', domain: 'document' })).toBe(false);
        expect(matchesCommand(docs, { query: '', domain: 'unknown' })).toBe(false);
    });
    it('keeps all terms, unknown input, exact IDs, and English substring behavior', () => {
        expect(matchesCommand(docs, { query: ' DOCS.+CREATE ' })).toBe(true);
        expect(matchesCommand(docs, { query: 'doc mark' })).toBe(true);
        expect(matchesCommand(messages, { query: 'find messages nonexistent' })).toBe(false);
        expect(matchesCommand(docs, { query: '\u521b\u5efa\u6587\u6863\u672a\u77e5' })).toBe(false);
        expect(matchesCommand(docs, { query: '' })).toBe(true);
    });
});

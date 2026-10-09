import { expect, it } from 'vitest';
import { exampleArguments } from './support/schema-examples';

it('uses structured API input without aliases or optional transport flags', () => {
    expect(exampleArguments({ type: 'object', properties: {
        params: { anyOf: [{ type: 'object', properties: { id: { type: 'string' } } }, { type: 'string' }] },
        body: { anyOf: [{ type: 'object', properties: { title: { type: 'string' } } }, { type: 'string' }] },
        data: { type: 'string' }, output: { type: 'string' }, jq: { type: 'string' }, 'page-all': { type: 'boolean' },
    } })).toEqual({ params: { id: 'fixture/value' }, body: { title: 'fixture/value' } });
});

it('keeps regular schemas populated when no API input envelope exists', () => {
    expect(exampleArguments({ type: 'object', properties: { event: { type: 'string' } } })).toEqual({ event: 'fixture/value' });
});

import { SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { RemotePureEngine } from '../../src/infrastructure/http/pure-engine';
it('executes parsing and card formatting inside the private Docs Durable Object', async () => {
    const engine = new RemotePureEngine(SELF);
    expect(await engine.parse('<p>Hello world</p>')).toMatchObject({ word_count: 2, block_count: 1 });
    expect(await engine.format('{"elements":[{"tag":"markdown","content":"Hello card"}]}', [])).toContain('Hello card');
    expect(await engine.process({ operation: 'jq', expression: '.[] | . * 2', input: [2, 3] })).toEqual([4, 6]);
});

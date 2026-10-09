import { expect, it } from 'vitest';
import { documentParser, imCardFormatter } from '../../src/infrastructure/documents/adapter';

it('initializes the exact pure engine during a native request and reuses it concurrently', async () => {
    const profiles = await Promise.all(Array.from({ length: 4 }, () => documentParser.parse('<p>Hello world</p>')));
    for (const profile of profiles) expect(profile).toMatchObject({ word_count: 2, block_count: 1 });
    expect(await imCardFormatter.format('{"elements":[{"tag":"markdown","content":"Hello card"}]}', [])).toContain('Hello card');
    expect((await documentParser.parse('<p>Again</p>')).block_count).toBe(1);
});

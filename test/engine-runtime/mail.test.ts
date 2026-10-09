import { SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { RemotePureEngine } from '../../src/infrastructure/http/pure-engine';
it('keeps Mail transforms private and rejects Docs operations in the Mail service', async () => {
    const engine = new RemotePureEngine(SELF);
    await expect(engine.parse('<p>Text</p>')).rejects.toMatchObject({ code: 'ENGINE_OPERATION_UNAVAILABLE' });
    expect(await engine.processMail({ operation: 'lint', html: '<p>Hello</p>' })).toBeDefined();
});

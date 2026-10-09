import { expect, it, vi } from 'vitest';
import { RemotePureEngine } from '../src/infrastructure/http/pure-engine';
import { pureEngineResponse } from '../src/bootstrap/pure-engine-handler';

it('routes pure operations over the private binding and preserves their results', async () => {
    const parse = vi.fn(async () => ({ word_count: 2, char_count: 10, breakdown: {}, block_count: 1, blocks: [] }));
    const engine = new RemotePureEngine({ fetch: (request: Request) => pureEngineResponse(request, { parse }) });
    expect(await engine.parse('<p>Hello world</p>')).toMatchObject({ word_count: 2 });
    expect(parse).toHaveBeenCalledWith('<p>Hello world</p>');
    await expect(engine.format('card', [])).rejects.toMatchObject({ code: 'ENGINE_OPERATION_UNAVAILABLE' });
});
it('rejects unknown operations and malformed input before invoking a transform', async () => {
    const parse = vi.fn();
    for (const body of [{ operation: 'fetch', url: 'https://example.com' }, { operation: 'parse', args: [3] }]) {
        const response = await pureEngineResponse(new Request('https://engine.internal/', { method: 'POST', body: JSON.stringify(body) }), { parse });
        expect(response.status).toBe(400);
    }
    expect(parse).not.toHaveBeenCalled();
});
it('sanitizes internal failures and missing bindings', async () => {
    const engine = new RemotePureEngine({ fetch: (request: Request) => pureEngineResponse(request, { parse: async () => { throw new Error('private internals'); } }) });
    await expect(engine.parse('x')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    await expect(new RemotePureEngine().parse('x')).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' });
});

it('delegates exact document-to-message Markdown conversion', async () => {
    const toIMMarkdown = vi.fn(async () => 'converted');
    const engine = new RemotePureEngine({ fetch: (request: Request) => pureEngineResponse(request, { toIMMarkdown }) });
    expect(await engine.toIMMarkdown('source', 'doc')).toBe('converted');
    expect(toIMMarkdown).toHaveBeenCalledWith('source', 'doc');
});
it('uses the event-specific card converter independently of API message formatting', async () => {
    const formatEvent = vi.fn(async () => 'event card');
    const engine = new RemotePureEngine({ fetch: (request: Request) => pureEngineResponse(request, { formatEvent }) });
    expect(await engine.formatEvent('raw', [])).toBe('event card');
    expect(formatEvent).toHaveBeenCalledWith('raw', []);
});

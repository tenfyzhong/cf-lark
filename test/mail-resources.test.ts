import { expect, it, vi } from 'vitest';
import { mailResourceStep } from '../src/capabilities/mail/resources';
it('resolves source attachment URLs in repeated query batches and stages bytes privately', async () => {
    const request = vi
            .fn()
            .mockResolvedValue({
                download_urls: [
                    {
                        attachment_id: 'att',
                        download_url: 'https://files.example/x',
                    },
                ],
            }),
        stream = vi.fn().mockResolvedValue(new Response('abc')),
        ingest = vi.fn().mockResolvedValue({ id: 'private', size: 3 });
    const context = { grant: { id: 'owner' }, lark: { request } } as never;
    const first = await mailResourceStep(
        {
            phase: 'urls',
            items: [{ source: 'message', key: 'att', name: 'x.txt' }],
            mailbox: 'me',
            messageId: 'm',
            index: 0,
        },
        context,
        { ingest } as never,
        { stream } as never,
    );
    expect(first.done).toBe(false);
    if (first.done) return;
    expect(request.mock.calls[0]![0]).toMatchObject({
        query: { attachment_ids: ['att'] },
        queryEncoding: { attachment_ids: 'repeat' },
    });
    const second = await mailResourceStep(
        first.state,
        context,
        { ingest } as never,
        { stream } as never,
    );
    expect(second.done).toBe(false);
    if (second.done) return;
    const third = await mailResourceStep(
        second.state,
        context,
        { ingest } as never,
        { stream } as never,
    );
    if (third.done) throw Error('Expected download step');
    const final = await mailResourceStep(
        third.state,
        context,
        { ingest } as never,
        { stream } as never,
    );
    expect(final).toMatchObject({
        done: true,
        files: [{ id: 'private', name: 'x.txt' }],
    });
    expect(ingest.mock.calls[0]![0]).toBe('owner');
});

import { expect, it, vi } from 'vitest';
import { provisionR2, retentionRule } from '../scripts/deploy/r2';
const input = { accountId: 'a'.repeat(32), bucketName: 'cf-lark-private', token: 'private-test-token' };
const ok = (result: unknown = {}) => Response.json({ success: true, result });
const missing = () => Response.json({ success: false }, { status: 404 });
const lifecycle = () => ok({ rules: [retentionRule] });

it('creates missing Standard buckets before configuring retention without publishing them', async () => {
    const request = vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(ok())
        .mockResolvedValueOnce(ok({ rules: [] })).mockResolvedValueOnce(ok());
    await provisionR2(input, request);
    expect(request.mock.calls.map((call) => call[1].method)).toEqual(['GET', 'POST', 'GET', 'PUT']);
    expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual({ name: input.bucketName, storageClass: 'Standard' });
    expect(JSON.parse(request.mock.calls[3]![1].body)).toEqual({ rules: [retentionRule] });
    expect(retentionRule.deleteObjectsTransition.condition.maxAge).toBe(86400);
    expect(retentionRule.abortMultipartUploadsTransition.condition.maxAge).toBe(86400);
    for (const [url, init] of request.mock.calls) {
        expect(url).toMatch(/^https:\/\/api.cloudflare.com\/client\/v4\/accounts\//u);
        expect(url).not.toContain('/domains');
        expect(init.headers.Authorization).toBe('Bearer ' + input.token);
        expect(init.redirect).toBe('error');
        expect(init.signal).toBeInstanceOf(AbortSignal);
    }
});

it('reuses existing buckets without mutations when retention is already configured', async () => {
    const request = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(lifecycle());
    await provisionR2(input, request);
    expect(request.mock.calls.map((call) => call[1].method)).toEqual(['GET', 'GET']);
});

it('recognizes equivalent lifecycle rules regardless of API property order', async () => {
    const reordered = Object.fromEntries(Object.entries(retentionRule).reverse());
    const request = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok({ rules: [reordered] }));
    await provisionR2(input, request);
    expect(request).toHaveBeenCalledTimes(2);
});

it('preserves unrelated lifecycle rules and replaces only its managed rule', async () => {
    const other = { id: 'operator-rule', enabled: false, conditions: { prefix: 'other/' } };
    const request = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok({ rules: [other, { ...retentionRule, enabled: false }] })).mockResolvedValueOnce(ok());
    await provisionR2(input, request);
    expect(JSON.parse(request.mock.calls[2]![1].body)).toEqual({ rules: [other, retentionRule] });
});

it('accepts a create race only after confirming the bucket exists', async () => {
    const request = vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(new Response('', { status: 409 }))
        .mockResolvedValueOnce(ok()).mockResolvedValueOnce(lifecycle());
    await provisionR2(input, request);
    expect(request).toHaveBeenCalledTimes(4);
});

for (const response of [new Response('private-test-token', { status: 403 }), new Response('<html>private-test-token</html>', { status: 502 }), Response.json({ success: false })]) {
    it(`fails closed for unsuccessful lookup ${response.status} without printing upstream values`, async () => {
        const request = vi.fn().mockResolvedValue(response);
        await expect(provisionR2(input, request)).rejects.toThrow('R2 bucket lookup failed');
        expect(request).toHaveBeenCalledTimes(1);
    });
}

it('fails if a conflicting create is not followed by a readable bucket', async () => {
    const request = vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(new Response('', { status: 409 })).mockResolvedValueOnce(missing());
    await expect(provisionR2(input, request)).rejects.toThrow('R2 bucket creation failed');
});

it('stops on lifecycle failure and can repair retention on the next deployment', async () => {
    const request = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok({ rules: [] }))
        .mockResolvedValueOnce(new Response('', { status: 403 }));
    await expect(provisionR2(input, request)).rejects.toThrow('R2 lifecycle update failed');
    const retry = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok({ rules: [] })).mockResolvedValueOnce(ok());
    await provisionR2(input, retry);
    expect(retry.mock.calls.map((call) => call[1].method)).not.toContain('POST');
});

it('does not overwrite malformed lifecycle responses', async () => {
    const request = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok({}));
    await expect(provisionR2(input, request)).rejects.toThrow('R2 lifecycle lookup failed');
    expect(request).toHaveBeenCalledTimes(2);
});

it('does not leak credentials from network errors', async () => {
    await expect(provisionR2(input, vi.fn().mockRejectedValue(new Error(input.token)))).rejects.toThrow('R2 bucket lookup failed');
});

it('rejects invalid configuration before issuing requests', async () => {
    for (const update of [{ accountId: '' }, { bucketName: '../unsafe' }, { token: '' }]) {
        const request = vi.fn();
        await expect(provisionR2({ ...input, ...update }, request)).rejects.toThrow('Invalid R2 provisioning configuration');
        expect(request).not.toHaveBeenCalled();
    }
});

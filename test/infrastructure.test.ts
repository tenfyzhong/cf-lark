import { describe, expect, it, vi } from 'vitest';
import { SecretBox } from '../src/infrastructure/crypto/secret-box';
import { LarkHttpClient } from '../src/infrastructure/lark/http-client';

describe('credential encryption', () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(19)));
    it('authenticates record identity and randomizes ciphertext', async () => {
        const box = new SecretBox(key);
        const first = await box.encrypt('profile:one', 'app-secret');
        const second = await box.encrypt('profile:one', 'app-secret');
        expect(first).not.toContain('app-secret');
        expect(first).not.toEqual(second);
        expect(await box.decrypt('profile:one', first)).toBe('app-secret');
        await expect(box.decrypt('profile:two', first)).rejects.toThrow();
        await expect(new SecretBox(btoa('x'.repeat(32))).decrypt('profile:one', first)).rejects.toThrow();
    });
    it('classifies malformed key encoding without exposing the key', () => {
        expect(() => new SecretBox('invalid-key!')).toThrow(expect.objectContaining({ code: 'INVALID_ENCRYPTION_KEY' }));
    });
    it('rejects invalid key length', () => {
        expect(() => new SecretBox(btoa('short'))).toThrow();
    });
});

describe('Lark transport', () => {
    it.each([
        ['feishu', 'https://open.feishu.cn'], ['lark', 'https://open.larksuite.com'],
    ] as const)('routes %s to its exact origin', async (brand, origin) => {
        const send = vi.fn(async (_request: Request) => Response.json({ code: 0, data: { items: [1] } }));
        const client = new LarkHttpClient(brand, async () => 'secret-token', send);
        const result = await client.request({ method: 'GET', path: '/open-apis/im/v1/chats', query: { page_size: 10 } });
        expect(result).toEqual({ items: [1] });
        const req = send.mock.calls[0]![0] as unknown as Request;
        expect(req.url).toBe(origin + '/open-apis/im/v1/chats?page_size=10');
        expect(req.headers.get('Authorization')).toBe('Bearer secret-token');
        expect(req.redirect).toBe('manual');
    });
    it('does not request tokens or send traffic for unsafe paths', async () => {
        const token = vi.fn(async () => 'secret');
        const send = vi.fn();
        const client = new LarkHttpClient('feishu', token, send);
        await expect(client.request({ method: 'GET', path: '//evil.example' })).rejects.toThrow();
        expect(token).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });
    it('reports upstream API errors without echoing response secrets', async () => {
        const client = new LarkHttpClient('feishu', async () => 'secret', async () =>
            Response.json({ code: 99991672, msg: 'sensitive debug data' }));
        await expect(client.request({ method: 'GET', path: '/open-apis/im/v1/chats' })).rejects.toMatchObject({
            code: 'UPSTREAM_ERROR', details: { upstreamCode: 99991672 },
        });
    });
    it('does not replay ambiguous writes', async () => {
        const send = vi.fn(async () => { throw new Error('connection reset'); });
        const client = new LarkHttpClient('feishu', async () => 'secret', send);
        await expect(client.request({ method: 'POST', path: '/open-apis/im/v1/messages', body: {} }))
            .rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
        expect(send).toHaveBeenCalledTimes(1);
    });
    it('enforces the invocation request budget', async () => {
        const send = vi.fn(async () => Response.json({ code: 0, data: {} }));
        const client = new LarkHttpClient('feishu', async () => 'secret', send, 1);
        await client.request({ method: 'GET', path: '/open-apis/im/v1/chats' });
        await expect(client.request({ method: 'GET', path: '/open-apis/im/v1/chats' }))
            .rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
        expect(send).toHaveBeenCalledTimes(1);
    });
});

it('encrypts bounded workflow payloads without argument-count limits', async () => {
    const box = new SecretBox(btoa(String.fromCharCode(...new Uint8Array(32))));
    const value = 'workflow-content-'.repeat(20_000);
    const encrypted = await box.encrypt('workflow-large', value);
    expect(await box.decrypt('workflow-large', encrypted)).toBe(value);
});

it('classifies upstream name collisions without exposing arbitrary upstream messages', async () => {
    const client = new LarkHttpClient('feishu', async () => 'token', async () => Response.json({ code: 40000000, msg: 'command already exists' }));
    await expect(client.request({ method: 'POST', path: '/open-apis/application/v7/app_slash_commands' })).rejects.toMatchObject({
        code: 'UPSTREAM_ERROR', details: { upstreamCode: 40000000, reason: 'command_already_exists' },
    });
});

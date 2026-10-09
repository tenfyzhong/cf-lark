import { createHash } from 'node:crypto';
import { env, runInDurableObject } from 'cloudflare:test';
import { expect, it, vi } from 'vitest';
import { ArtifactService } from '../../src/application/artifacts';
import { SqliteArtifactLedger } from '../../src/infrastructure/storage/artifact-ledger';
import { PrivateR2Bucket } from '../../src/infrastructure/storage/r2-bucket';
import { LarkHttpClient } from '../../src/infrastructure/lark/http-client';
import { mailEngine } from '../../src/infrastructure/documents/mail-adapter';
import { streamMailDraftJSON } from '../../src/capabilities/mail/stream';
import type { CommandContext } from '../../src/ports/capabilities';
import type { Env } from '../../src/bootstrap/worker';
const MiB = 1024 * 1024;
const context: CommandContext = {
    lark: { request: async () => { throw new Error('Unexpected upstream request'); } },
    grant: { id: 'mail-stream-owner', revoked: false, expiresAt: Date.now() + 3600000, domains: ['mail', 'artifact'], permissions: ['read', 'write'], profiles: [{ profileId: 'p', identities: ['user'], accounts: ['a'] }] },
    selection: { profileId: 'p', identity: 'user', accountId: 'a' },
};
const input = { from: { address: 'sender@example.com' }, to: [{ address: 'recipient@example.com' }], subject: 'Streaming attachment', text: 'Private fixture' };
async function fixture(name: string, run: (artifacts: ArtifactService) => Promise<void>) {
    await runInDurableObject((env as unknown as Env).AUTHORITY.getByName(`mail-stream-${name}`), async (_instance, state) => {
        const artifacts = new ArtifactService(new SqliteArtifactLedger(state.storage.sql, { maxBytes: 2_000_000_000, maxClassA: 100000, maxClassB: 100000 }), new PrivateR2Bucket((env as unknown as Env).ARTIFACTS));
        await run(artifacts);
    });
}
function source(size: number) {
    const hash = createHash('sha256'); let offset = 0;
    return { hash, body: new ReadableStream<Uint8Array>({ pull(controller) {
        if (offset === size) { controller.close(); return; }
        const chunk = new Uint8Array(Math.min(65536, size - offset));
        for (let i = 0; i < chunk.length; i++) chunk[i] = (offset + i) % 251;
        hash.update(chunk); offset += chunk.length; controller.enqueue(chunk);
    } }) };
}
/** Consume only bounded lines and base64 carry, never the complete request. */
async function inspect(request: Request) {
    let requestBytes = 0, mimeBytes = 0, attachmentBytes = 0, carry = '', line = '', prefix = '', suffix = '';
    let inAttachment = false, attachmentHeader = false, ended = false;
    const hash = createHash('sha256'), decoder = new TextDecoder();
    const mime = (bytes: Uint8Array) => {
        mimeBytes += bytes.length; line += decoder.decode(bytes);
        for (;;) {
            const end = line.indexOf('\n'); if (end < 0) break;
            const value = line.slice(0, end); line = line.slice(end + 1);
            if (value.startsWith('--')) { if (inAttachment) ended = true; inAttachment = false; }
            if (inAttachment && value) { expect(value.length).toBeLessThanOrEqual(76); const decoded = Buffer.from(value, 'base64'); hash.update(decoded); attachmentBytes += decoded.length; }
            if (value.includes('filename="payload.txt"')) attachmentHeader = true;
            if (attachmentHeader && value === '') { inAttachment = true; attachmentHeader = false; }
        }
        expect(line.length).toBeLessThan(4096);
    };
    const reader = request.body!.getReader();
    for (;;) {
        const next = await reader.read(); if (next.done) break; requestBytes += next.value.length;
        let text = new TextDecoder().decode(next.value);
        if (prefix.length < 8) { const take = Math.min(8 - prefix.length, text.length); prefix += text.slice(0, take); text = text.slice(take); }
        const quote = text.indexOf('"'); if (quote >= 0) { suffix += text.slice(quote); text = text.slice(0, quote); }
        carry += text; const count = carry.length - carry.length % 4;
        if (count) { mime(Buffer.from(carry.slice(0, count), 'base64url')); carry = carry.slice(count); }
    }
    if (carry) mime(Buffer.from(carry, 'base64url'));
    expect(prefix).toBe('{"raw":"'); expect(suffix).toBe('"}'); expect(ended).toBe(true);
    return { requestBytes, mimeBytes, attachmentBytes, digest: hash.digest('hex') };
}
it('streams an 18 MiB private attachment through native R2, pinned MIME and the real HTTP client', async () => {
    await fixture('large', async artifacts => {
        const bytes = source(18 * MiB), artifact = await artifacts.upload(context.grant.id, 18 * MiB, bytes.body);
        const expected = bytes.hash.digest('hex');
        const pure = { processMail: vi.fn(async (value: Parameters<typeof mailEngine.processMail>[0]) => { expect(JSON.stringify(value).length).toBeLessThan(4096); return mailEngine.processMail(value); }) };
        const send = vi.fn(async (request: Request) => {
            expect(request.headers.get('Authorization')).toBe('Bearer private-fixture');
            expect(new URL(request.url).pathname).toBe('/open-apis/mail/v1/user_mailboxes/me/drafts');
            const result = await inspect(request);
            expect(result.attachmentBytes).toBe(18 * MiB); expect(result.digest).toBe(expected);
            expect(result.mimeBytes).toBeGreaterThan(24 * MiB); expect(result.mimeBytes).toBeLessThanOrEqual(25 * MiB);
            expect(result.requestBytes).toBe(4 * Math.ceil(result.mimeBytes / 3) + 10);
            return Response.json({ code: 0, data: { draft_id: 'draft-streamed' } });
        });
        const client = new LarkHttpClient('feishu', async () => 'private-fixture', send);
        const body = await streamMailDraftJSON(input, [{ file: { id: artifact.id, name: 'payload.txt' }, kind: 'attachment' }], context, artifacts, pure);
        expect(await client.requestStream({ method: 'POST', path: '/open-apis/mail/v1/user_mailboxes/me/drafts', body })).toEqual({ draft_id: 'draft-streamed' });
        expect(send).toHaveBeenCalledTimes(1); expect(pure.processMail).toHaveBeenCalledTimes(1);
        await artifacts.remove(context.grant.id, artifact.id);
    });
}, 120000);
it('rejects EML over 25 MiB before upstream writes and enforces private ownership', async () => {
    await fixture('boundary', async artifacts => {
        const bytes = source(19 * MiB), artifact = await artifacts.upload(context.grant.id, 19 * MiB, bytes.body);
        const send = vi.fn(async () => Response.json({ code: 0, data: {} }));
        const client = new LarkHttpClient('feishu', async () => 'private-fixture', send);
        const parts = [{ file: { id: artifact.id, name: 'payload.txt' }, kind: 'attachment' as const }];
        await expect((async () => { const body = await streamMailDraftJSON(input, parts, context, artifacts, mailEngine); await client.requestStream({ method: 'POST', path: '/open-apis/mail/v1/user_mailboxes/me/drafts', body }); })()).rejects.toThrow('25 MiB');
        await expect(streamMailDraftJSON(input, parts, { ...context, grant: { ...context.grant, id: 'other-owner' } }, artifacts, mailEngine)).rejects.toMatchObject({ status: 404 });
        expect(send).not.toHaveBeenCalled(); await artifacts.remove(context.grant.id, artifact.id);
    });
}, 120000);

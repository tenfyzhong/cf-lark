import { createCipheriv, createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { verifyCallback } from '../src/infrastructure/lark/event-verifier';

const config = { appId: 'cli_fixture', verificationToken: 'verify-fixture', encryptKey: 'encrypt-fixture' };
const now = 1791474000000;
function input(payload: object, encrypted = false) {
    let body = JSON.stringify(payload);
    if (encrypted) {
        const iv = new Uint8Array(16).fill(7);
        const cipher = createCipheriv('aes-256-cbc', createHash('sha256').update(config.encryptKey).digest(), iv);
        const data = Buffer.concat([iv, cipher.update(body), cipher.final()]);
        body = JSON.stringify({ encrypt: data.toString('base64') });
    }
    const timestamp = String(now / 1000);
    const nonce = 'fixture-nonce';
    const signature = createHash('sha256').update(timestamp + nonce + config.encryptKey + body).digest('hex');
    return { body, timestamp, nonce, signature };
}
const event = { schema: '2.0', header: { event_id: 'event-1', event_type: 'im.message.receive_v1', app_id: config.appId, token: config.verificationToken }, event: { message: { text: 'Example' } } };

it('verifies signed and encrypted callbacks and preserves event identity', async () => {
    expect(await verifyCallback(input(event), config, now)).toMatchObject({ id: 'event-1', type: 'im.message.receive_v1', payload: { ...event, header: { event_id: event.header.event_id, event_type: event.header.event_type, app_id: config.appId } } });
    expect(await verifyCallback(input(event, true), config, now)).toMatchObject({ id: 'event-1', payload: { ...event, header: { event_id: event.header.event_id, event_type: event.header.event_type, app_id: config.appId } } });
});
it('rejects tampering, stale timestamps and the wrong application', async () => {
    await expect(verifyCallback({ ...input(event), signature: '0'.repeat(64) }, config, now)).rejects.toMatchObject({ status: 401 });
    await expect(verifyCallback(input(event), config, now + 301_000)).rejects.toMatchObject({ status: 401 });
    await expect(verifyCallback(input({ ...event, header: { ...event.header, app_id: 'other' } }), config, now)).rejects.toMatchObject({ status: 401 });
});
it('accepts URL verification only for the configured verification token', async () => {
    const challenge = { type: 'url_verification', challenge: 'challenge-fixture', token: config.verificationToken };
    expect(await verifyCallback({ body: JSON.stringify(challenge) }, config, now)).toEqual({ challenge: 'challenge-fixture' });
    await expect(verifyCallback({ body: JSON.stringify({ ...challenge, token: 'wrong' }) }, config, now)).rejects.toMatchObject({ status: 401 });
});

it('removes callback credentials from verified business payloads', async () => {
    const result = await verifyCallback(input(event), config, now);
    expect(JSON.stringify(result)).not.toContain(config.verificationToken);
    if ('payload' in result) expect(result.payload.event).toEqual(event.event);
});

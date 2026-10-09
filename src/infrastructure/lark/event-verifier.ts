import { publicEventPayload } from '../../domain/event-payload';
import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import { ServiceError } from '../../domain/errors';

interface CallbackConfig { appId: string; verificationToken: string; encryptKey: string }
interface CallbackInput { body: string; timestamp?: string; nonce?: string; signature?: string }
export type VerifiedCallback = { challenge: string } | { id: string; type: string; payload: Record<string, unknown> };

function reject(): never { throw new ServiceError('INVALID_CALLBACK', 'Callback verification failed.', 401); }

export async function verifyCallback(input: CallbackInput, config: CallbackConfig, now = Date.now()): Promise<VerifiedCallback> {
    if (!config.encryptKey || !config.verificationToken || new TextEncoder().encode(input.body).byteLength > 1024 * 1024) reject();
    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(input.body) as Record<string, unknown>;
        if (typeof payload.encrypt === 'string') {
            const encrypted = Buffer.from(payload.encrypt, 'base64');
            if (encrypted.length < 32 || encrypted.length % 16 !== 0) reject();
            const decipher = createDecipheriv('aes-256-cbc', createHash('sha256').update(config.encryptKey).digest(), encrypted.subarray(0, 16));
            decipher.setAutoPadding(false);
            const plaintext = new TextDecoder().decode(Buffer.concat([decipher.update(encrypted.subarray(16)), decipher.final()]));
            payload = JSON.parse(plaintext.slice(plaintext.indexOf('{'), plaintext.lastIndexOf('}') + 1)) as Record<string, unknown>;
        }
    } catch { reject(); }
    const header = payload.header as Record<string, unknown> | undefined;
    const token = header?.token ?? payload.token;
    if (token !== config.verificationToken) reject();
    if (payload.type === 'url_verification' && typeof payload.challenge === 'string') return { challenge: payload.challenge };
    if (!input.timestamp || !/^\d+$/u.test(input.timestamp) || Math.abs(Number(input.timestamp) * 1000 - now) > 300_000
        || !input.nonce || !input.signature || !/^[a-f0-9]{64}$/u.test(input.signature)) reject();
    const expected = createHash('sha256').update(input.timestamp + input.nonce + config.encryptKey + input.body).digest();
    if (!timingSafeEqual(expected, Buffer.from(input.signature, 'hex'))) reject();
    const event = payload.event as Record<string, unknown> | undefined;
    const appId = header?.app_id ?? event?.app_id ?? payload.app_id;
    const id = header?.event_id ?? payload.uuid;
    const type = header?.event_type ?? event?.type;
    if (appId !== config.appId || typeof id !== 'string' || !id || typeof type !== 'string' || !type) reject();
    return { id, type, payload: publicEventPayload(payload) };
}

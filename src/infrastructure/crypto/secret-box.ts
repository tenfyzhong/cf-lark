import { ServiceError } from '../../domain/errors';

const encoder = new TextEncoder();

function encode(bytes: Uint8Array): string {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
}

function decode(value: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export class SecretBox {
    private readonly key: Promise<CryptoKey>;

    constructor(base64Key: string) {
        let bytes: Uint8Array<ArrayBuffer>;
        try { bytes = decode(base64Key); }
        catch { throw new ServiceError('INVALID_ENCRYPTION_KEY', 'Encryption requires a base64-encoded 256-bit key.', 500); }
        if (bytes.byteLength !== 32) throw new ServiceError('INVALID_ENCRYPTION_KEY', 'Encryption requires a 256-bit key.', 500);
        this.key = crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }

    async encrypt(recordId: string, plaintext: string): Promise<string> {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData: encoder.encode(recordId) },
            await this.key, encoder.encode(plaintext),
        );
        return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
    }

    async decrypt(recordId: string, ciphertext: string): Promise<string> {
        const [version, nonce, body, extra] = ciphertext.split('.');
        if (version !== 'v1' || !nonce || !body || extra) throw new ServiceError('INVALID_CIPHERTEXT', 'Invalid encrypted record.', 500);
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: decode(nonce), additionalData: encoder.encode(recordId) },
            await this.key, decode(body),
        );
        return new TextDecoder().decode(plaintext);
    }
}

export async function hash(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomToken(): string {
    return encode(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

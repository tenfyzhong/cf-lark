import type { ContentHasher } from '../../ports/content-hasher';
export class CloudflareContentHasher implements ContentHasher {
    async sha256(body: ReadableStream<Uint8Array>): Promise<string> {
        // The DOM Crypto declaration does not include the Workers streaming extension.
        const runtime = crypto as Crypto & { DigestStream: new (algorithm: string) => WritableStream<Uint8Array> & { digest: Promise<ArrayBuffer> } };
        const digest = new runtime.DigestStream('SHA-256');
        const result = digest.digest;
        // Observe both promises immediately because a failed source also rejects the digest.
        const [, bytes] = await Promise.all([body.pipeTo(digest), result]);
        return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }
}

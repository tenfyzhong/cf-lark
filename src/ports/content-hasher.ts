export interface ContentHasher {
    sha256(body: ReadableStream<Uint8Array>): Promise<string>;
}

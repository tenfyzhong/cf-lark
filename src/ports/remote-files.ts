export interface RemoteFiles {
    stream(url: string, maxBytes: number): Promise<Response>;
    read(url: string, maxBytes: number): Promise<{ body: Blob; name: string; contentType: string }>;
    put(url: string, body: ReadableStream<Uint8Array>, size: number,
        options?: { contentType?: string; contentDisposition?: string }): Promise<{ etag?: string }>;
}

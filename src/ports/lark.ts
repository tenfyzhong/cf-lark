import type { Brand, JsonObject } from '../domain/models';

export interface ApiRequest {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    query?: JsonObject;
    queryEncoding?: Record<string, 'json' | 'repeat' | 'comma'>;
    body?: unknown;
    rawBody?: string;
    responseMode?: 'data' | 'envelope';
}

export interface LarkClient {
    readonly brand?: Brand;
    request(request: ApiRequest): Promise<JsonObject>;
}

export interface UploadRequest {
    method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    query?: JsonObject;
    fields: Record<string, string>;
    file: { field: string; name: string; body: Blob };
}

export interface StreamingUploadRequest {
    method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    query?: JsonObject;
    fields: Record<string, string>;
    file: { field: string; name: string; size: number; body: ReadableStream<Uint8Array> };
}

export interface DownloadRequest {
    path: string;
    method?: ApiRequest['method'];
    body?: unknown;
    query?: JsonObject;
    queryEncoding?: ApiRequest['queryEncoding'];
}

export interface StreamingApiRequest extends Omit<ApiRequest, 'body' | 'rawBody'> {
    body: ReadableStream<Uint8Array>;
    size?: number;
}

export interface LarkTransferClient extends LarkClient {
    requestStream(input: StreamingApiRequest): Promise<JsonObject>;
    upload(request: UploadRequest): Promise<JsonObject>;
    uploadStream(request: StreamingUploadRequest): Promise<JsonObject>;
    download(request: DownloadRequest): Promise<Response>;
}

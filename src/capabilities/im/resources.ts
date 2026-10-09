import { saveDownloadResponse } from '../files/index';
import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { Capability } from '../../ports/capabilities';
import type { DownloadRequest, LarkTransferClient } from '../../ports/lark';
import { resourceDefinition } from './resource-definition';
function prepare(args: JsonObject): DownloadRequest {
    const message = String(args['message-id'] ?? '').trim(), key = String(args['file-key'] ?? '').trim();
    if (!message.startsWith('om_') || !key || /[/\\]/u.test(key) || !['image', 'file'].includes(String(args.type))) throw new ServiceError('INVALID_ARGUMENTS', 'Provide a message ID, resource key without separators, and image/file type.');
    if (args.output !== undefined && (!String(args.output).trim() || String(args.output).trim() === '.')) throw new ServiceError('INVALID_ARGUMENTS', 'output must name a file.');
    return { path: `/open-apis/im/v1/messages/${encodeURIComponent(message)}/resources/${encodeURIComponent(key)}`, query: { type: args.type } };
}
export function resourceCapability(artifacts?: ArtifactFiles): Capability {
    return { definition: resourceDefinition, preview: async (args) => ({ ...prepare(args), storage: 'private artifact', filename: args.output ?? args['file-key'] }), execute: async (args, context) => {
        const request = prepare(args);
        authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'write' }, Date.now());
        if (!artifacts) throw new ServiceError('UNAVAILABLE', 'Artifact storage is unavailable.', 503);
        const response = await (context.lark as LarkTransferClient).download(request);
        const disposition = response.headers.get('content-disposition') ?? '';
        let serverName = /filename="([^"]+)"/iu.exec(disposition)?.[1] ?? /filename=([^;]+)/iu.exec(disposition)?.[1];
        const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(disposition)?.[1];
        if (encoded) try { serverName = decodeURIComponent(encoded); } catch { /* Ignore malformed encoded filenames. */ }
        serverName = serverName?.trim().split(/[/\\]/u).at(-1);
        if (serverName && (/^[.]{1,2}$/u.test(serverName) || /[\x00-\x1f\x7f]/u.test(serverName))) serverName = undefined;
        let filename = String(args.output ?? serverName ?? args['file-key']).split(/[/\\]/u).at(-1)!;
        const extensions: Record<string, string> = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg", "application/pdf": ".pdf", "video/mp4": ".mp4", "video/3gpp": ".3gp", "video/x-msvideo": ".avi", "audio/mpeg": ".mp3", "audio/ogg": ".ogg", "audio/wav": ".wav", "text/plain": ".txt", "text/html": ".html", "text/css": ".css", "text/csv": ".csv", "application/zip": ".zip", "application/x-zip-compressed": ".zip", "application/x-rar-compressed": ".rar", "application/json": ".json", "application/xml": ".xml", "application/octet-stream": ".bin", "application/msword": ".doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx", "application/vnd.ms-excel": ".xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx", "application/vnd.ms-powerpoint": ".ppt", "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx"};
        if (!filename.includes('.')) filename += (serverName ? /\.[^.]+$/u.exec(serverName)?.[0] : undefined) ?? extensions[(response.headers.get('content-type') ?? '').split(';')[0]!] ?? '';
        const saved = await saveDownloadResponse(artifacts, context, response, filename);
        return { ...saved, saved_path: filename };
    } };
}

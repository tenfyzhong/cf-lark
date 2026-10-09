import type { JsonObject } from '../../domain/models';
const extensions: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/vnd.microsoft.icon',
    pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', html: 'text/html', htm: 'text/html', xml: 'text/xml', css: 'text/css', js: 'text/javascript', md: 'text/markdown',
    zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
    doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
export function attachmentMetadata(bytes: Uint8Array, name: string): JsonObject {
    let mime = extensions[name.split('.').at(-1)!.toLowerCase()] || '';
    const header = bytes.slice(0, 512), text = String.fromCharCode(...header);
    if (!mime) {
        if (text.startsWith('\x89PNG\r\n\x1a\n')) mime = 'image/png';
        else if (header[0] === 255 && header[1] === 216 && header[2] === 255) mime = 'image/jpeg';
        else if (text.startsWith('GIF87a') || text.startsWith('GIF89a')) mime = 'image/gif';
        else if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') mime = 'image/webp';
        else if (text.startsWith('%PDF-')) mime = 'application/pdf';
        else {
            mime = 'application/octet-stream';
            try { const decoded = new TextDecoder('utf-8', { fatal: true }).decode(header); if (header.length && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(decoded)) mime = 'text/plain'; } catch { /* Binary data keeps the default media type. */ }
        }
    }
    return { mime_type: mime };
}

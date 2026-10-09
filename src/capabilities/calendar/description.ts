import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { ArtifactStore } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
import type { LarkTransferClient } from '../../ports/lark';
import { invalid } from './helpers';
const pattern = /!\[([^\]]*)\]\(([^)]*)\)/g;
export function hasArtifactImage(markdown: string): boolean { return markdown.startsWith('@artifact:') || [...markdown.matchAll(pattern)].some(match => match[2]!.trim().startsWith('artifact:')); }
export function validateDescription(markdown: string): void { for (const match of markdown.matchAll(pattern)) { const source = match[2]!.trim(); if (source && !/^(https?:|data:|artifact:)/i.test(source)) invalid('Hosted descriptions require HTTPS image URLs or artifact:<id> references instead of local paths.'); } }
function dimensions(data: Uint8Array): [number, number] {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data.length >= 24 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71) return [view.getUint32(16), view.getUint32(20)];
    if (data.length >= 10 && String.fromCharCode(...data.slice(0, 3)) === 'GIF') return [view.getUint16(6, true), view.getUint16(8, true)];
    if (data[0] === 255 && data[1] === 216) { let offset = 2; while (offset + 4 < data.length) { if (data[offset] !== 255) break; const marker = data[offset + 1]!, length = view.getUint16(offset + 2); if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && offset + 9 <= data.length) return [view.getUint16(offset + 7), view.getUint16(offset + 5)]; if (length < 2) break; offset += length + 2; } } return [0, 0];
}
export async function resolveCalendarDescription(markdown: string, calendar: string, context: CommandContext, artifacts?: ArtifactStore): Promise<string> {
    if (markdown.startsWith('@artifact:')) {
        if (!artifacts) throw new ServiceError('NOT_CONFIGURED', 'Calendar description artifacts are unavailable.', 503);
        authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now());
        const response = await artifacts.read(context.grant.id, markdown.slice(10)), reader = response.body?.getReader(); if (!reader) invalid('Description artifact has no body.');
        const chunks: Uint8Array[] = []; let size = 0; try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 256 * 1024) throw new ServiceError('RESOURCE_LIMIT', 'Calendar descriptions are limited to 256 KiB.', 413); chunks.push(part.value); } } catch (error) { await reader.cancel(); throw error; } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } const result = new TextDecoder('utf-8', { fatal: true }).decode(bytes); validateDescription(result); if (result.startsWith('@artifact:')) invalid('Nested description file references are unsupported.'); return result;
    }
    validateDescription(markdown); const reference = [...markdown.matchAll(pattern)].map(match => match[2]!.trim()).find(source => source.startsWith('artifact:')); if (!reference) return markdown;
    if (!artifacts) throw new ServiceError('NOT_CONFIGURED', 'Calendar image artifacts are unavailable.', 503);
    authorize(context.grant, { ...context.selection, domain: 'artifact', risk: 'read' }, Date.now()); const id = reference.slice(9); if (!id) invalid('Artifact image ID is empty.'); const response = await artifacts.read(context.grant.id, id), reader = response.body?.getReader(); if (!reader) invalid('Image artifact has no body.');
    const chunks: Uint8Array[] = []; let size = 0; try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 20 * 1024 * 1024) throw new ServiceError('RESOURCE_LIMIT', 'Calendar inline images are limited to 20 MiB.', 413); chunks.push(part.value); } } catch (error) { await reader.cancel(); throw error; } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } const [width, height] = dimensions(bytes), uploaded = await (context.lark as LarkTransferClient).upload({ path: '/open-apis/drive/v1/medias/upload_all', fields: { file_name: id, parent_type: 'calendar', parent_node: calendar, size: String(size) }, file: { field: 'file', name: id, body: new Blob([bytes]) } }); if (!uploaded.file_token) throw new ServiceError('INVALID_RESPONSE', 'Calendar image upload omitted file_token.', 502);
    const host = context.lark.brand === 'lark' ? 'internal-api-drive-stream.larksuite.com' : 'internal-api-drive-stream.feishu.cn', url = `https://${host}/space/api/box/stream/download/preview/${encodeURIComponent(String(uploaded.file_token))}?preview_type=16${width && height ? `&im_w=${width}&im_h=${height}` : ''}${size ? `&im_size=${size}` : ''}`;
    return markdown.replace(pattern, (whole, alt: string, source: string) => source.trim() === reference ? `![${alt}](${url})` : whole);
}

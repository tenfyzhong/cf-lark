import { authorize } from '../../domain/authorization';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
import { invalid } from './common';
export async function readMailText(
    reference: string,
    context: CommandContext,
    files: ArtifactFiles | undefined,
    maximum = 1 << 20,
): Promise<string> {
    if (!files) invalid('Artifact storage is unavailable.');
    const id = reference.replace(/^@/, '');
    if (!id || /[\r\n\0]/.test(id)) invalid('An artifact ID is required.');
    authorize(
        context.grant,
        { ...context.selection, domain: 'artifact', risk: 'read' },
        Date.now(),
    );
    const metadata = await files.stat(context.grant.id, id);
    if (metadata.size > maximum)
        invalid(`Text input exceeds ${maximum} bytes.`);
    const response = await files.read(context.grant.id, id),
        reader = response.body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0,
        text = '';
    try {
        for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > maximum) {
                await reader.cancel();
                invalid(`Text input exceeds ${maximum} bytes.`);
            }
            text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
    } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
    }
    if (size !== metadata.size)
        invalid('Artifact byte length does not match its metadata.');
    return text;
}

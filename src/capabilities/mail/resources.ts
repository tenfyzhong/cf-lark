import type { ArtifactFiles } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
import type { RemoteFiles } from '../../ports/remote-files';
import { invalid, path, type Data } from './common';
export type MailResourceResult =
    | {
          done: true;
          files: Data[];
      }
    | {
          done: false;
          state: Data;
      };
/** Resolve signed URLs separately from credential-free streamed downloads. */
export async function mailResourceStep(
    state: Data,
    context: CommandContext,
    artifacts: ArtifactFiles,
    remote: RemoteFiles,
): Promise<MailResourceResult> {
    const items: Data[] = state.items;
    if (state.phase === 'urls') {
        const unresolved = items.filter((item) => !item.url && !item.failed);
        if (!unresolved.length)
            return {
                done: false,
                state: { ...state, phase: 'download', index: 0, files: [] },
            };
        const source = unresolved[0]!.source,
            batch = unresolved
                .filter((item) => item.source === source)
                .slice(0, 20);
        const data: Data = await context.lark.request({
            method: 'GET',
            path: path(
                state.mailbox,
                source === 'template' ? 'templates' : 'messages',
                source === 'template' ? state.templateId : state.messageId,
                'attachments',
                'download_url',
            ),
            query: { attachment_ids: batch.map((item) => item.key) },
            queryEncoding: { attachment_ids: 'repeat' },
        });
        const failed = new Set(
            (data.failed_ids ?? []).map((v: unknown) =>
                typeof v === 'string' ? v : (v as Data).attachment_id,
            ),
        );
        const updated = items.map((item) => {
            if (!batch.includes(item)) return item;
            const url = (data.download_urls ?? []).find(
                (v: Data) => v.attachment_id === item.key,
            )?.download_url;
            if (!url && !failed.has(item.key))
                invalid('Attachment download URL is missing.');
            if (failed.has(item.key) && item.cid)
                invalid('Inline attachment download failed.');
            return { ...item, url, failed: failed.has(item.key) };
        });
        return { done: false, state: { ...state, items: updated } };
    }
    if (state.phase !== 'download') invalid('Unknown mail resource phase.');
    const remaining = items.filter((item) => !item.failed),
        index = state.index ?? 0;
    if (index >= remaining.length)
        return { done: true, files: state.files ?? [] };
    const item = remaining[index]!,
        maximum =
            item.source === 'signature' ? 10 * 1024 * 1024 : 25 * 1024 * 1024;
    if (!artifacts.ingest)
        invalid('Streaming artifact ingestion is unavailable.');
    const response = await remote.stream(item.url, maximum);
    if (!response.body) invalid('Attachment response has no body.');
    const artifact = await artifacts.ingest(
        context.grant.id,
        maximum,
        response.body,
    );
    return {
        done: false,
        state: {
            ...state,
            index: index + 1,
            files: [
                ...(state.files ?? []),
                {
                    id: artifact.id,
                    name: item.name,
                    ...(item.cid ? { cid: item.cid } : {}),
                    internal: true,
                },
            ],
        },
    };
}

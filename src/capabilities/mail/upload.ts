import { authorize } from '../../domain/authorization';
import { ServiceError } from '../../domain/errors';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { CommandContext } from '../../ports/capabilities';
import type { LarkTransferClient } from '../../ports/lark';
import { invalid, type Data } from './common';
const blockedExtensions = new Set(
    'action apk app applescript asp awk bash bat bin cdxml chm cmd coffee com command cpl csh dart dll es exe fish gadget go hta inf1 ins inx ipa isu jar job js jse ksh lnk lua msc msh msh1 msh1xml msh2 msh2xml mshxml msi msp mst msu osx out paf php pif pl plist pls pm prg ps ps1 ps1xml ps2 ps2xml psc1 psc2 psd1 psdm1 psm1 pssc py pyc pyo pyw pyz pyzw rb reg rgs run scf scr sct sh shb shs tcsh terminal ts tsx u3p vb vbe vbs vbscript ws wsc wsf wsh zsh'.split(
        ' ',
    ),
);
export type MailUploadResult =
    | {
          done: true;
          file_token: string;
          size: number;
      }
    | {
          done: false;
          state: Data;
      };
/** One upstream request per durable step; byte ranges stay in private artifacts. */
export async function mailUploadStep(
    state: Data,
    context: CommandContext,
    artifacts: ArtifactFiles,
): Promise<MailUploadResult> {
    authorize(
        context.grant,
        { ...context.selection, domain: 'artifact', risk: 'read' },
        Date.now(),
    );
    const file = state.file,
        client = context.lark as LarkTransferClient;
    if (!file?.id || !file.name || /[\r\n\0]/.test(file.name) || !state.openId)
        invalid(
            'Upload requires an artifact, filename and current user open_id.',
        );
    if (!['prepare', 'parts'].includes(state.phase))
        invalid('Unknown mail upload phase.');
    const extension = String(file.name)
        .split('/')
        .at(-1)!
        .match(/\.([^.]+)$/)?.[1]
        ?.toLowerCase();
    if (extension && blockedExtensions.has(extension))
        invalid('File extension is not allowed as a mail attachment.');
    const size = Number(file.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > 3 * 1024 ** 3)
        invalid('Mail attachments must be at most 3 GiB.');
    const token = (data: Data): MailUploadResult => {
        if (typeof data.file_token !== 'string' || !data.file_token)
            throw new ServiceError(
                'INVALID_UPSTREAM_RESPONSE',
                'Upload response has no file_token.',
            );
        return { done: true, file_token: data.file_token, size };
    };
    if (state.phase === 'prepare') {
        if (size <= 20 * 1024 * 1024 && !state.forceMultipart) {
            const response = await artifacts.read(context.grant.id, file.id);
            if (!response.body) invalid('Artifact body is unavailable.');
            const data = await client.uploadStream({
                path: '/open-apis/drive/v1/medias/upload_all',
                fields: {
                    file_name: file.name,
                    parent_type: 'email',
                    parent_node: state.openId,
                    size: String(size),
                },
                file: {
                    field: 'file',
                    name: file.name,
                    size,
                    body: response.body,
                },
            });
            return token(data);
        }
        const data = await client.request({
            method: 'POST',
            path: '/open-apis/drive/v1/medias/upload_prepare',
            body: {
                file_name: file.name,
                parent_type: 'email',
                parent_node: state.openId,
                size,
            },
        });
        const blockSize = Number(data.block_size),
            blockNum = Number(data.block_num);
        if (
            typeof data.upload_id !== 'string' ||
            !data.upload_id ||
            !Number.isSafeInteger(blockSize) ||
            blockSize <= 0 ||
            blockSize > 20 * 1024 * 1024 ||
            !Number.isSafeInteger(blockNum) ||
            blockNum !== Math.ceil(size / blockSize)
        )
            throw new ServiceError(
                'INVALID_UPSTREAM_RESPONSE',
                'Invalid server upload block plan.',
            );
        return {
            done: false,
            state: {
                ...state,
                phase: 'parts',
                uploadId: data.upload_id,
                blockSize,
                blockNum,
                seq: 0,
            },
        };
    }
    if (state.phase === 'parts' && state.seq < state.blockNum) {
        const offset = state.seq * state.blockSize,
            length = Math.min(state.blockSize, size - offset),
            response = await artifacts.read(context.grant.id, file.id, {
                offset,
                length,
            });
        if (!response.body) invalid('Artifact range is unavailable.');
        await client.uploadStream({
            path: '/open-apis/drive/v1/medias/upload_part',
            fields: {
                upload_id: state.uploadId,
                seq: String(state.seq),
                size: String(length),
            },
            file: {
                field: 'file',
                name: file.name,
                size: length,
                body: response.body,
            },
        });
        return { done: false, state: { ...state, seq: state.seq + 1 } };
    }
    return token(
        await client.request({
            method: 'POST',
            path: '/open-apis/drive/v1/medias/upload_finish',
            body: { upload_id: state.uploadId, block_num: state.blockNum },
        }),
    );
}

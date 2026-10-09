import type { ArtifactFiles } from '../../ports/artifacts';
import { uploadPrograms } from './upload-programs';

export function mediaUploadProgram(artifacts: ArtifactFiles, options?: { id: string; domain: string }) {
    return { ...uploadPrograms(artifacts).find((program) => program.id === 'docs-media-upload')!, ...options };
}
export { uploadPrograms } from './upload-programs';

export function fileUploadProgram(artifacts: ArtifactFiles, options: { id: string; domain: string }) {
    return { ...uploadPrograms(artifacts).find((program) => program.id === 'drive-upload')!, ...options };
}
export { saveDownloadResponse } from './download';

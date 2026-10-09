import type { Capability } from '../../ports/capabilities';
import type { WorkflowRunner } from '../../ports/workflows';
import { uploadDefinitions } from './definitions';
import { uploadPreview } from './upload-programs';

export function uploadCapabilities(runner: WorkflowRunner): Capability[] {
    return uploadDefinitions.map((definition) => {
        const media = definition.domain === 'docs';
        return { definition, preview: async (args) => uploadPreview(args, media),
            execute: async (args, context) => {
                uploadPreview(args, media);
                return runner.start(media ? 'docs-media-upload' : 'drive-upload', { phase: 'start', args }, context.selection, context.grant);
            } };
    });
}

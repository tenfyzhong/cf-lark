import type { ContentHasher } from '../../ports/content-hasher';
import type { ArtifactFiles } from '../../ports/artifacts';
import type { WorkflowRunner } from '../../ports/workflows';
import { driveDefinitions } from './definitions';
import { driveCapabilities } from './commands';
import { driveCommentDefinitions } from './comment-definitions';
import { driveCommentCapabilities } from './comments';
import { driveMetadataDefinitions } from './metadata-definitions';
import { driveMetadataCapabilities } from './metadata';
import { driveSearchDefinition } from './search-definition';
import { driveSearchCapability } from './search';
import { driveMutationDefinitions, driveTaskResultDefinition } from './task-definitions';
import { driveMutationCapabilities, driveMutationPrograms, driveTaskResultCapability } from './tasks';
import { driveDownloadDefinitions } from './download-definitions';
import { driveDownloadCapabilities } from './downloads';
import { driveConversionDefinitions } from './conversion-definitions';
import { driveConversionCapabilities, driveConversionPrograms } from './conversions';
export { conversionProgram } from './conversions';
import { driveDirectoryDefinitions } from './directory-definitions';
import { driveDirectoryCapabilities, driveDirectoryPrograms } from './directories';
export const allDriveDefinitions = [...driveDefinitions, ...driveCommentDefinitions, ...driveMetadataDefinitions, driveSearchDefinition, ...driveMutationDefinitions, driveTaskResultDefinition, ...driveDownloadDefinitions, ...driveConversionDefinitions, ...driveDirectoryDefinitions];
export function allDriveCapabilities({ workflows, artifacts }: { workflows: WorkflowRunner; artifacts: ArtifactFiles }) {
    return [...driveCapabilities(), ...driveCommentCapabilities(), ...driveMetadataCapabilities(), driveSearchCapability(), ...driveMutationCapabilities(workflows), driveTaskResultCapability(), ...driveDownloadCapabilities(artifacts), ...driveConversionCapabilities(workflows), ...driveDirectoryCapabilities(workflows)];
}
export function drivePrograms(artifacts: ArtifactFiles, hasher: ContentHasher) { return [...driveMutationPrograms(), ...driveConversionPrograms(artifacts), ...driveDirectoryPrograms(artifacts, hasher)]; }

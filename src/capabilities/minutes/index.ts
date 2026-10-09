import type { ArtifactStore } from '../../ports/artifacts';
import type { RemoteFiles } from '../../ports/remote-files';
import type { WorkflowRunner } from '../../ports/workflows';
import { minutesCapabilities } from './commands';
import { minutesDefinitions } from './definitions';
import { minutesReadCapabilities, minutesReadPrograms } from './read';
import { minutesReadDefinitions } from './read-definitions';
import { minutesDownloadCapability, minutesDownloadProgram } from './download';
import { minutesDownloadDefinition } from './download-definition';
export const allMinutesDefinitions = [...minutesDefinitions, ...minutesReadDefinitions, minutesDownloadDefinition];
export function allMinutesCapabilities(workflows: WorkflowRunner) { return [...minutesCapabilities(), ...minutesReadCapabilities(workflows), minutesDownloadCapability(workflows)]; }
export function minutesPrograms(artifacts: ArtifactStore, remote: RemoteFiles) { return [...minutesReadPrograms(artifacts), minutesDownloadProgram(artifacts, remote)]; }

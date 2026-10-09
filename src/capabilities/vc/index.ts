import type { ArtifactStore } from '../../ports/artifacts';
import type { WorkflowRunner } from '../../ports/workflows';
import { vcCapabilities } from './commands';
import { vcDefinitions } from './definitions';
import { vcQueryCapabilities, vcQueryPrograms } from './query';
import { vcQueryDefinitions } from './query-definitions';
import { vcNotesCapability, vcNotesProgram } from './notes';
import { vcNotesDefinition } from './notes-definition';
import { vcEventsCapability, vcEventsProgram } from './events';
import { vcEventsDefinition } from './events-definition';
import { vcScreenshotCapability } from './screenshot';
import { vcScreenshotDefinition } from './screenshot-definition';
export const allVCDefinitions = [...vcDefinitions, ...vcQueryDefinitions, vcNotesDefinition, vcEventsDefinition, vcScreenshotDefinition];
export function allVCCapabilities(workflows: WorkflowRunner, artifacts: ArtifactStore) {
    return [...vcCapabilities(), ...vcQueryCapabilities(workflows), vcNotesCapability(workflows), vcEventsCapability(workflows), vcScreenshotCapability(artifacts)];
}
export function vcPrograms(artifacts: ArtifactStore) { return [...vcQueryPrograms(), vcNotesProgram(artifacts), vcEventsProgram()]; }

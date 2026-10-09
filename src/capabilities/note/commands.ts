import type { Capability } from '../../ports/capabilities';
import type { WorkflowRunner } from '../../ports/workflows';
import { noteDetailCapability } from './detail';
import { noteTranscriptCapability } from './transcript';

export function noteCapabilities(workflows?: WorkflowRunner): Capability[] {
    return [noteDetailCapability(), ...(workflows ? [noteTranscriptCapability(workflows)] : [])];
}

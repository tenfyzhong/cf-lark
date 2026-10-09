import { rawApiCapability } from './raw-api/commands';
import { eventConsumerCapabilities, type EventConsumeService } from './event/index';
import { docsWriteCapabilities } from './docs/writes';
import { mailCapabilities } from './mail/commands';
import type { MailTransformer } from '../ports/mail';
import type { BaseRecordFormatter } from './base/record-export';
import { calendarCapabilities } from './calendar/index';
import { docsScriptCapability } from './docs/script';
import type { DocumentParser } from '../ports/document-parser';
import { eventSubscribeCapability } from './event/consume';
import { allMinutesCapabilities } from './minutes/index';
import { allVCCapabilities } from './vc/index';
import { slidesImageCapabilities } from './slides/images';
import { slidesWorkflowCapabilities } from './slides/workflows';
import { slidesMutationCapabilities } from './slides/mutations';
import { slidesCapabilities } from './slides/commands';
import { docsAuthoringCapabilities } from './docs/authoring';
import { docsMediaCapabilities } from './docs/media';
import { docsCapabilities } from './docs/commands';
import { imCapabilities } from './im/commands';
import { allDriveCapabilities } from './drive/index';
import { markdownCapabilities } from './markdown/commands';
import { wikiCapabilities } from './wiki/commands';
import { okrCapabilities } from './okr/commands';
import type { RemoteFiles } from '../ports/remote-files';
import { baseCapabilities } from './base/commands';
import { appsCapabilities } from './apps/commands';
import { sheetsCapabilities } from './sheets/commands';
import { whiteboardCapabilities } from './whiteboard/commands';
import { taskCapabilities } from './task/commands';
import { noteCapabilities } from './note/commands';
import { contactCapabilities } from './contact/commands';
import type { ArtifactFiles } from '../ports/artifacts';
import type { EventInbox } from '../ports/events';
import type { WorkflowRunner } from '../ports/workflows';
import type { ApiDescriptor } from '../domain/api-descriptor';
import type { Capability } from '../ports/capabilities';
import apiCatalog from './api/generated/catalog.json';
import { apiCapability } from './api/command';
import { applicationCapabilities } from './application/commands';
import { artifactCapabilities } from './artifact/commands';
import { uploadCapabilities } from './files/commands';
import { workflowCapability } from './workflow/resume';
import { eventCapability } from './event/inbox';

export interface CapabilityDependencies {
    artifacts: ArtifactFiles;
    remoteFiles?: RemoteFiles;
    documentParser?: DocumentParser;
    recordFormatter?: BaseRecordFormatter;
    mailTransformer?: MailTransformer;
    eventConsumers?: EventConsumeService;
    events: Pick<EventInbox, 'read'>;
    workflows: WorkflowRunner;
}
export function createCapabilities(dependencies: CapabilityDependencies): Capability[] {
    const apiDependencies = { artifacts: dependencies.artifacts, workflows: dependencies.workflows, formatter: dependencies.recordFormatter };
    return [rawApiCapability(apiDependencies), ...eventConsumerCapabilities(dependencies.eventConsumers), ...mailCapabilities(dependencies.workflows, dependencies.artifacts, dependencies.mailTransformer), ...calendarCapabilities(dependencies.workflows), ...(dependencies.documentParser ? [docsScriptCapability(dependencies.artifacts, dependencies.documentParser, dependencies.remoteFiles)] : []), eventSubscribeCapability(dependencies.events, dependencies.artifacts), ...wikiCapabilities(dependencies.workflows), ...markdownCapabilities(dependencies.workflows), ...allDriveCapabilities(dependencies), ...imCapabilities(dependencies), ...docsCapabilities(dependencies.artifacts, dependencies.documentParser).filter((capability) => capability.definition.id !== 'docs.+update'), ...docsMediaCapabilities(dependencies.artifacts), ...docsAuthoringCapabilities(dependencies.workflows), ...slidesCapabilities(dependencies.artifacts), ...slidesMutationCapabilities(dependencies.workflows), ...slidesWorkflowCapabilities(dependencies.artifacts, dependencies.workflows), ...slidesImageCapabilities(dependencies.artifacts), ...allVCCapabilities(dependencies.workflows, dependencies.artifacts), ...allMinutesCapabilities(dependencies.workflows), ...okrCapabilities(dependencies.workflows), ...(apiCatalog as unknown as ApiDescriptor[]).map(descriptor => apiCapability(descriptor, apiDependencies)), ...applicationCapabilities(), ...baseCapabilities(dependencies), ...appsCapabilities(dependencies.workflows), ...sheetsCapabilities(dependencies.artifacts, dependencies.workflows),
        ...whiteboardCapabilities(dependencies.artifacts), ...taskCapabilities(dependencies.workflows), ...contactCapabilities(), ...noteCapabilities(dependencies.workflows),
        ...artifactCapabilities(dependencies.artifacts), ...uploadCapabilities(dependencies.workflows),
        workflowCapability(dependencies.workflows), ...docsWriteCapabilities(dependencies.workflows), eventCapability(dependencies.events)];
}

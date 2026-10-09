import { apiPrograms } from './api/command';
import { rawApiPrograms } from './raw-api/commands';
import apiCatalog from './api/generated/catalog.json';
import type { ApiDescriptor } from '../domain/api-descriptor';
import type { MailTransformer } from '../ports/mail';
import { docsWritePrograms } from './docs/writes';
import type { ContentHasher } from '../ports/content-hasher';
import { mailPrograms } from './mail/commands';
import type { BaseRecordFormatter } from './base/record-export';
import type { EventInbox } from '../ports/events';
import { calendarPrograms } from './calendar/index';
import type { ImCardFormatter } from './im/card';
import { minutesPrograms } from './minutes/index';
import { vcPrograms } from './vc/index';
import { slidesPrograms } from './slides/workflows';
import { docsAuthoringPrograms } from './docs/authoring';
import { imPrograms } from './im/commands';
import { drivePrograms } from './drive/index';
import { markdownPrograms } from './markdown/commands';
import { wikiPrograms } from './wiki/commands';
import { okrPrograms } from './okr/workflows';
import { sheetsPrograms } from './sheets/programs';
import { appsPrograms } from './apps/programs';
import { basePrograms } from './base/programs';
import type { RemoteFiles } from '../ports/remote-files';
import type { ArtifactFiles } from '../ports/artifacts';
import type { WorkflowProgram } from '../ports/workflows';
import { uploadPrograms } from './files/upload-programs';
import { noteTranscriptProgram } from './note/transcript';
import { taskPrograms } from './task/commands';

export interface WorkflowDependencies {
    artifacts: ArtifactFiles;
    remoteFiles?: RemoteFiles;
    cardFormatter?: ImCardFormatter;
    recordFormatter?: BaseRecordFormatter;
    events?: Pick<EventInbox, 'read'>;
    hasher?: ContentHasher;
    mailTransformer?: MailTransformer;
}

export function createWorkflowPrograms(dependencies: WorkflowDependencies): WorkflowProgram[] {
    const { artifacts, remoteFiles, cardFormatter, recordFormatter, events, hasher, mailTransformer } = dependencies;
    const apiDependencies = { artifacts, formatter: recordFormatter };
    return [...apiPrograms(apiCatalog as unknown as ApiDescriptor[], apiDependencies), ...rawApiPrograms(apiDependencies), ...docsWritePrograms(artifacts, remoteFiles), ...mailPrograms(artifacts, events, mailTransformer, remoteFiles), ...calendarPrograms(artifacts), ...(remoteFiles ? minutesPrograms(artifacts, remoteFiles) : []), ...vcPrograms(artifacts), ...slidesPrograms(artifacts), ...docsAuthoringPrograms(artifacts, remoteFiles), ...imPrograms({ artifacts, remoteFiles, cardFormatter }), ...(hasher ? drivePrograms(artifacts, hasher) : []), ...markdownPrograms(artifacts), ...wikiPrograms(), ...okrPrograms(artifacts), ...sheetsPrograms(artifacts), ...appsPrograms(remoteFiles ? { artifacts, remoteFiles } : undefined), ...basePrograms(artifacts, recordFormatter), ...uploadPrograms(artifacts), noteTranscriptProgram(artifacts), ...taskPrograms(artifacts)];
}

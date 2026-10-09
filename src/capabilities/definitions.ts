import { rawApiDefinition } from './raw-api/definitions.ts';
import { driveDirectoryDefinitions } from './drive/directory-definitions.ts';
import { eventConsumerDefinitions } from './event/lifecycle-definitions.ts';
import { mailDefinitions } from './mail/definitions.ts';
import { driveConversionDefinitions } from './drive/conversion-definitions.ts';
import { docsScriptDefinition } from './docs/script-definition.ts';
import { calendarMutationDefinitions } from './calendar/mutation-definitions.ts';
import { calendarCreateDefinition } from './calendar/create-definition.ts';
import { calendarAgendaDefinition } from './calendar/agenda-definition.ts';
import { calendarAvailabilityDefinitions } from './calendar/availability-definitions.ts';
import { calendarCoreDefinitions } from './calendar/core-definitions.ts';
import { driveDownloadDefinitions } from './drive/download-definitions.ts';
import { driveTaskResultDefinition } from './drive/task-definitions.ts';
import { driveMutationDefinitions } from './drive/task-definitions.ts';
import { driveSearchDefinition } from './drive/search-definition.ts';
import { driveMetadataDefinitions } from './drive/metadata-definitions.ts';
import { driveCommentDefinitions } from './drive/comment-definitions.ts';
import { driveDefinitions } from './drive/definitions.ts';
import { eventSubscribeDefinition } from './event/definitions.ts';
import { minutesDownloadDefinition } from './minutes/download-definition.ts';
import { minutesReadDefinitions } from './minutes/read-definitions.ts';
import { minutesDefinitions } from './minutes/definitions.ts';
import { vcScreenshotDefinition } from './vc/screenshot-definition.ts';
import { vcEventsDefinition } from './vc/events-definition.ts';
import { vcNotesDefinition } from './vc/notes-definition.ts';
import { vcQueryDefinitions } from './vc/query-definitions.ts';
import { vcDefinitions } from './vc/definitions.ts';
import { slidesImageDefinitions } from './slides/image-definitions.ts';
import { slidesWorkflowDefinitions } from './slides/workflow-definitions.ts';
import { slidesMutationDefinitions } from './slides/mutation-definitions.ts';
import { slidesDefinitions } from './slides/definitions.ts';
import { docsAuthoringDefinitions } from './docs/authoring-definitions.ts';
import { docsMediaDefinitions } from './docs/media-definitions.ts';
import { docsDefinitions } from './docs/definitions.ts';
import { imDefinitions } from './im/definitions.ts';
import { markdownDefinitions } from './markdown/definitions.ts';
import { wikiDefinitions } from './wiki/definitions.ts';
import { okrDefinitions } from './okr/definitions.ts';
import { baseDefinitions } from './base/definitions.ts';
import { appsDefinitions } from './apps/definitions.ts';
import { sheetsDefinitions } from './sheets/definitions.ts';
import { whiteboardDefinitions } from './whiteboard/definitions.ts';
import { taskDefinitions } from './task/definitions.ts';
import { noteDefinitions } from './note/definitions.ts';
import { contactDefinitions } from './contact/definitions.ts';
import apiCatalog from './api/generated/catalog.json' with { type: 'json' };
import type { CommandDefinition } from '../domain/models';
import { applicationDefinitions } from './application/definitions.ts';
import { artifactDefinitions } from './artifact/definitions.ts';
import { uploadDefinitions } from './files/definitions.ts';
import { workflowDefinition } from './workflow/definition.ts';
import { documentCreateDefinition } from './shortcuts/definitions.ts';
import { inboxDefinition } from './event/inbox-definition.ts';

export const commandDefinitions: readonly CommandDefinition[] = [
    rawApiDefinition,
    ...okrDefinitions, ...wikiDefinitions, ...markdownDefinitions, ...imDefinitions, ...docsDefinitions, ...docsMediaDefinitions, ...docsAuthoringDefinitions, ...slidesDefinitions, ...slidesMutationDefinitions, ...slidesWorkflowDefinitions, ...slidesImageDefinitions, ...vcDefinitions, ...vcQueryDefinitions, vcNotesDefinition, vcEventsDefinition, vcScreenshotDefinition, ...minutesDefinitions, ...minutesReadDefinitions, minutesDownloadDefinition, eventSubscribeDefinition, ...driveDefinitions, ...driveCommentDefinitions, ...driveMetadataDefinitions, driveSearchDefinition, ...driveMutationDefinitions, driveTaskResultDefinition, ...driveDownloadDefinitions, ...calendarCoreDefinitions, ...calendarAvailabilityDefinitions, calendarAgendaDefinition, calendarCreateDefinition, ...calendarMutationDefinitions, docsScriptDefinition, ...mailDefinitions, ...driveConversionDefinitions, ...eventConsumerDefinitions, ...driveDirectoryDefinitions, ...apiCatalog.map((item) => item.definition as CommandDefinition), ...applicationDefinitions, ...baseDefinitions, ...appsDefinitions, ...sheetsDefinitions, ...whiteboardDefinitions, ...taskDefinitions, ...contactDefinitions, ...noteDefinitions, ...artifactDefinitions,
    ...uploadDefinitions, workflowDefinition, documentCreateDefinition,
    inboxDefinition,
];

import { describe, it, expect, vi } from 'vitest';
import { driveMutationPrograms } from '../src/capabilities/drive/tasks';
import { driveConversionPrograms } from '../src/capabilities/drive/conversions';
import { driveDirectoryPrograms } from '../src/capabilities/drive/directories';
import { wikiPrograms } from '../src/capabilities/wiki/commands';
import type { ArtifactFiles } from '../src/ports/artifacts';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
import { ServiceError } from '../src/domain/errors';
const artifacts = {} as ArtifactFiles;
function context(response: JsonObject | Error): CommandContext { return { selection: { profileId: 'p', identity: 'user' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [], domains: ['drive', 'wiki'], permissions: ['read', 'write'] }, lark: { request: vi.fn(async () => { if (response instanceof Error) throw response; return response; }) } }; }
describe('Drive and Wiki durable poll cadence', () => {
    it('schedules task and conversion polls two seconds apart', async () => {
        const mutation = driveMutationPrograms().find((item) => item.id === 'drive-delete')!;
        expect(await mutation.step({ args: { 'file-token': 'file', type: 'file' }, taskId: 'task', polls: 0 }, context({ status: 'pending' }))).toMatchObject({ done: false, retryAfter: 2000 });
        const conversion = driveConversionPrograms(artifacts).find((item) => item.id === 'drive-export')!;
        expect(await conversion.step({ phase: 'poll', args: { token: 'doc' }, ticket: 'ticket', polls: 0, failures: 0 }, context({ result: { job_status: 2 } }))).toMatchObject({ done: false, retryAfter: 2000 });
        const directory = driveDirectoryPrograms(artifacts, { sha256: vi.fn() }).find((item) => item.id === 'drive-push')!;
        expect(await directory.step({ phase: 'delete-poll', args: {}, deletionTask: 'task', deletionPolls: 0 }, context({ status: 'pending' }))).toMatchObject({ done: false, retryAfter: 2000 });
    });
    it('delays Wiki pending tasks and retries transient create locks with bounded backoff', async () => {
        const deletion = wikiPrograms().find((item) => item.id === 'wiki-delete-space')!;
        expect(await deletion.step({ phase: 'poll', args: { 'space-id': '123' }, taskId: 'task', polls: 0 }, context({ task: { delete_space_result: { status: 'processing' } } }))).toMatchObject({ done: false, retryAfter: 2000 });
        const creation = wikiPrograms().find((item) => item.id === 'wiki-node-create')!;
        expect(await creation.step({ args: { 'space-id': '123' }, phase: 'start' }, context(new ServiceError('UPSTREAM_ERROR', 'lock', 409, { upstreamCode: 131009 })))).toMatchObject({ done: false, retryAfter: 250 });
    });
});

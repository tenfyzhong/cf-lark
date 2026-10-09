import { describe, expect, it, vi } from 'vitest';
import { minutesReadCapabilities, minutesReadPrograms } from '../src/capabilities/minutes/read';
import type { CommandContext } from '../src/ports/capabilities';
import type { ApiRequest } from '../src/ports/lark';
import type { JsonObject } from '../src/domain/models';
import type { ArtifactStore } from '../src/ports/artifacts';
const context = (request: CommandContext['lark']['request']): CommandContext => ({ lark: { request }, selection: { profileId: 'p', accountId: 'a', identity: 'user' }, grant: { id: 'g', expiresAt: Date.now() + 60000, revoked: false, profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], domains: ['minutes', 'artifact'], permissions: ['read', 'write'] } });
const artifacts = { upload: vi.fn(async () => ({ id: 'artifact1', size: 10, expiresAt: 9999999999999 })) } as unknown as ArtifactStore;
const runner = { start: vi.fn(async () => ({ workflowId: 'w', selection: { profileId: 'p', identity: 'user' as const }, status: 'pending' as const })), resume: vi.fn() };
describe('Minutes reads', () => {
    it('searches with explicit filters, resolves me once, strips avatars, and returns pagination', async () => {
        const request = vi.fn(async (r: ApiRequest) => r.path.includes('user_info') ? { open_id: 'ou_me' } : { items: [{ token: 't', meta_data: { avatar: 'private', description: 'Hello' } }], has_more: true, page_token: 'next' });
        const capability = minutesReadCapabilities(runner).find(c => c.definition.id === 'minutes.+search')!;
        const output = await capability.execute({ keyword: 'Hello', 'owner-ids': 'me,ou_other', start: '2026-10-01', end: '2026-10-02', 'page-size': '20' }, context(request));
        expect(request.mock.calls[1]![0]).toMatchObject({ query: { page_size: '20' }, body: { query: 'Hello', sorter: 'create_time_desc', filter: { owner_ids: ['ou_me', 'ou_other'], create_time: { start_time: '2026-10-01T00:00:00Z', end_time: '2026-10-02T23:59:59Z' } } } });
        expect(output).toMatchObject({ items: [{ meta_data: { description: 'Hello' } }], page_token: 'next' });
        expect(JSON.stringify(output)).not.toContain('avatar');
        const before = request.mock.calls.length;
        await capability.preview({ query: 'x', 'owner-ids': 'me' }, context(request));
        expect(request).toHaveBeenCalledTimes(before);
    });
    it('rejects empty filters, invalid date ranges and pagination before IO', async () => {
        const capability = minutesReadCapabilities(runner).find(c => c.definition.id === 'minutes.+search')!;
        for (const args of [{}, { query: 'x', 'page-size': 31 }, { start: '2026-10-03', end: '2026-10-02' }, { query: 'x'.repeat(51) }]) await expect(capability.preview(args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
    it('checkpoints metadata and selective artifacts separately with private transcript output', async () => {
        const program = minutesReadPrograms(artifacts)[0]!;
        const request = vi.fn(async (r: ApiRequest) => r.path.endsWith('/artifacts') ? { summary: 'Summary', transcript: 'Transcript', minute_todos: [{ content: 'task' }], keywords: ['ignored'] } : { minute: { title: 'Title', note_id: 'note' } });
        let state: JsonObject = { args: { 'minute-tokens': 'token1,token2', summary: true, transcript: true }, index: 0, results: [], phase: 'metadata' };
        for (let i = 0; i < 5; i++) {
            const before = request.mock.calls.length;
            const result = await program.step(state, context(request));
            expect(request.mock.calls.length - before).toBeLessThanOrEqual(1);
            if (result.done) {
                expect(result.output).toMatchObject({ minutes: [{ minute_token: 'token1', title: 'Title', artifacts: { summary: 'Summary', transcript_file: 'artifact1' } }, { minute_token: 'token2' }] });
                expect(JSON.stringify(result.output)).not.toContain('ignored');
                return;
            }
            state = result.state;
        }
        throw new Error('Workflow did not finish.');
    });
});
it('waits for artifacts with a fresh deadline after metadata finishes', async () => {
    const { ServiceError } = await import('../src/domain/errors');
    let now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
        const request = vi.fn<CommandContext['lark']['request']>().mockResolvedValueOnce({ minute: { title: 'T' } }).mockRejectedValueOnce(new ServiceError('UPSTREAM_ERROR', 'Processing', 502, { upstreamCode: 2091003 })).mockResolvedValueOnce({ summary: 'Ready' });
        const program = minutesReadPrograms(artifacts)[0]!;
        let state: JsonObject = { args: { 'minute-tokens': 'token', summary: true, 'wait-ready': true }, index: 0, results: [], phase: 'metadata' };
        const metadata = await program.step(state, context(request)); if (metadata.done) throw new Error('Expected metadata checkpoint'); state = metadata.state;
        const processing = await program.step(state, context(request));
        expect(processing).toMatchObject({ done: false, state: { phase: 'artifacts', nextPoll: now + 15000 } });
        if (processing.done) throw new Error('Expected processing checkpoint');
        await program.step(processing.state, context(request)); expect(request).toHaveBeenCalledTimes(2);
        now += 15000;
        const ready = await program.step(processing.state, context(request)); expect(ready).toMatchObject({ done: false, state: { results: [{ artifacts: { summary: 'Ready' } }] } });
    } finally { vi.restoreAllMocks(); }
});

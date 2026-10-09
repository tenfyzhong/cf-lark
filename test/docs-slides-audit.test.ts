import { expect, it, vi } from 'vitest';
import { docsWritePrograms } from '../src/capabilities/docs/writes';
import { slidesPrograms } from '../src/capabilities/slides/workflows';
import { ServiceError } from '../src/domain/errors';
import type { ApiRequest } from '../src/ports/lark';
import type { ArtifactFiles } from '../src/ports/artifacts';
import type { CommandContext } from '../src/ports/capabilities';
import type { JsonObject } from '../src/domain/models';
const files: ArtifactFiles = { stat: vi.fn(), read: vi.fn(), upload: vi.fn(), remove: vi.fn() };
function context(): CommandContext & { lark: { request: ReturnType<typeof vi.fn> } } {
    return { lark: { request: vi.fn(async (_request: ApiRequest): Promise<JsonObject> => ({})) }, selection: { profileId: 'p', identity: 'user', accountId: 'a' }, grant: { id: 'g', revoked: false, expiresAt: Date.now() + 60000, profiles: [{ profileId: 'p', identities: ['user'], accounts: ['a'] }], domains: ['docs', 'slides', 'artifact'], permissions: ['read', 'write'] } };
}
const docs = docsWritePrograms(files)[0]!;
it('rejects every resource that shares a returned block ID before any upload', async () => {
    const c = context();
    const result = await docs.step({ phase: 'correlate', args: {}, name: 'create', resources: [{ kind: 'file', marker: '@lcli_file_a', artifact: 'a', presentation: {} }, { kind: 'file', marker: '@lcli_file_b', artifact: 'b', presentation: {} }], result: { document: { document_id: 'doc', new_blocks: [{ block_id: 'same', block_token: '@lcli_file_a', block_type: 'file' }, { block_id: 'same', block_token: '@lcli_file_b', block_type: 'file' }] } } }, c);
    expect(result.done).toBe(false);
    if (!result.done) expect((result.state.outcomes as JsonObject[]).map(item => item.status)).toEqual(['correlation_failed', 'correlation_failed']);
    expect(c.lark.request).not.toHaveBeenCalled();
});
it.each([[1, 100], [4000, 4000], [50000, 10000], [0, 3000]])('honors server poll_after_ms=%i with bounded delay=%i', async (delay, expected) => {
    const c = context(); c.lark.request.mockResolvedValue({ task: { task_id: 'task', status: 'processing', poll_after_ms: delay } });
    const result = await docs.step({ phase: 'poll', args: {}, name: 'create', taskId: 'task', polls: 0, result: { task: { task_id: 'task', status: 'processing' } } }, c);
    expect(result).toMatchObject({ done: false, retryAfter: expected });
    expect(c.lark.request).toHaveBeenCalledOnce();
});
it('rejects task status envelopes that omit task without issuing another read', async () => {
    const c = context(); c.lark.request.mockResolvedValue({});
    await expect(docs.step({ phase: 'poll', args: {}, name: 'create', taskId: 'task', polls: 1, result: {} }, c)).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
    expect(c.lark.request).not.toHaveBeenCalled();
});
it('preserves business failure diagnostics nested in a succeeded async task', async () => {
    const c = context();
    let state: JsonObject = { phase: 'poll', args: {}, name: 'create', taskId: 'task', polls: 1, result: { task: { task_id: 'task', status: 'succeeded', result: { create_document: '{"result":"failed","reason":"Invalid element","issues":[{"line":3}]}' } } } };
    let output: unknown;
    for (let i = 0; i < 5; i++) { const result = await docs.step(state, c); if (result.done) { output = result.output; break; } state = result.state; }
    expect(output).toMatchObject({ result: 'failed', reason: 'Invalid element', issues: [{ line: 3 }] });
    expect(c.lark.request).not.toHaveBeenCalled();
});
it('retains the created replacement ID and error when deleting the old page fails', async () => {
    const c = context(); c.lark.request.mockRejectedValue(new ServiceError('UPSTREAM_ERROR', 'Revision conflict', 409));
    const program = slidesPrograms(files)[0]!;
    let state: JsonObject = { phase: 'delete', command: 'replace-pages', args: {}, token: 'deck', presentationId: 'deck', pages: [{ slide_id: 'old', content: '<slide/>' }], index: 0, results: [{ old_slide_id: 'old', new_slide_id: 'new', status: 'created' }], revision: 4 };
    const first = await program.step(state, c); expect(first.done).toBe(false);
    if (!first.done) state = first.state;
    const result = await program.step(state, c); expect(result.done).toBe(true);
    if (result.done) expect(result.output).toMatchObject({ results: [{ old_slide_id: 'old', new_slide_id: 'new', status: 'delete_failed', error_code: 'UPSTREAM_ERROR' }] });
    expect(c.lark.request).toHaveBeenCalledOnce();
});

it.each([
    new ServiceError('UPSTREAM_UNAVAILABLE', 'Transient transport', 502),
    new ServiceError('UPSTREAM_HTTP_ERROR', 'Temporary gateway failure', 502, { upstreamStatus: 503 }),
])('checkpoints replay-safe task GET failures with backoff: $code', async error => {
    const c = context(); c.lark.request.mockRejectedValue(error);
    const result = await docs.step({ phase: 'poll', args: {}, name: 'create', taskId: 'task', polls: 0, result: { task: { task_id: 'task', status: 'processing' } } }, c);
    expect(result).toMatchObject({ done: false, retryAfter: 3000, state: { taskId: 'task', phase: 'poll' } });
    expect(c.lark.request).toHaveBeenCalledExactlyOnceWith({ method: 'GET', path: '/open-apis/docs_ai/v1/async_tasks/task' });
});
it('does not retry authorization errors while polling document tasks', async () => {
    const c = context(); c.lark.request.mockRejectedValue(new ServiceError('UPSTREAM_HTTP_ERROR', 'Forbidden', 502, { upstreamStatus: 403 }));
    await expect(docs.step({ phase: 'poll', args: {}, name: 'create', taskId: 'task', polls: 0, result: { task: { task_id: 'task', status: 'processing' } } }, c)).rejects.toMatchObject({ code: 'UPSTREAM_HTTP_ERROR', details: { upstreamStatus: 403 } });
});
it('normalizes whitespace in async task identity and status like the pinned decoder', async () => {
    const c = context();
    const result = await docs.step({ phase: 'poll', args: {}, name: 'create', taskId: 'task', polls: 1, result: { task: { task_id: ' task ', status: ' SUCCEEDED ', result: { create_document: '{"document":{"document_id":"doc"}}' } } } }, c);
    expect(result).toMatchObject({ done: false, state: { phase: 'correlate', result: { document: { document_id: 'doc' } } } });
    expect(c.lark.request).not.toHaveBeenCalled();
});
it.each([
    { label: 'duplicate marker', resources: [{ kind: 'image', marker: '@lcli_img_a', artifact: 'a', presentation: {} }], blocks: [{ block_id: 'one', block_token: '@lcli_img_a', block_type: 27 }, { block_id: 'two', block_token: '@lcli_img_a', block_type: 27 }], expected: ['one', 'two'] },
    { label: 'duplicate block ID', resources: [{ kind: 'image', marker: '@lcli_img_a', artifact: 'a', presentation: {} }, { kind: 'image', marker: '@lcli_img_b', artifact: 'b', presentation: {} }], blocks: [{ block_id: 'same', block_token: '@lcli_img_a', block_type: 27 }, { block_id: 'same', block_token: '@lcli_img_b', block_type: 27 }], expected: ['same'] },
])('cleans verified empty placeholders exactly once for $label without uploading', async ({ resources, blocks, expected }) => {
    const c = context(); let revision = 7;
    c.lark.request.mockImplementation(async input => {
        if (input.method === 'GET') return { block: { block_id: input.path.split('/').at(-1), block_type: 27, image: { token: '' } } };
        expect(input.method).toBe('PATCH'); expect(input.body.revision_id).toBe(revision);
        return { document: { document_id: 'doc', revision_id: ++revision } };
    });
    let state: JsonObject = { phase: 'correlate', args: {}, name: 'create', resources, result: { document: { document_id: 'doc', revision_id: 7, new_blocks: blocks } } };
    let output: JsonObject | undefined;
    for (let i = 0; i < 50; i++) {
        const calls = c.lark.request.mock.calls.length; const result = await docs.step(state, c);
        expect(c.lark.request.mock.calls.length - calls).toBeLessThanOrEqual(1);
        if (result.done) { output = result.output as JsonObject; break; } state = result.state;
    }
    expect(output).toMatchObject({ result: 'failed' });
    expect(c.lark.request.mock.calls.filter(([input]) => input.method === 'PATCH').map(([input]) => input.body.block_id)).toEqual(expected);
    expect(files.read).not.toHaveBeenCalled();
});

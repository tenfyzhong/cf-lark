import { expect, it, vi } from 'vitest';
import { appsCapabilities } from '../src/capabilities/apps/commands';
import type { CommandContext } from '../src/ports/capabilities';
function fixture(name: string, data: Record<string, unknown> = {}) {
    const request = vi.fn().mockResolvedValue(data);
    const capability = appsCapabilities().find((item) => item.definition.id === `apps.+file-${name}`)!;
    return { request, run: (args: Record<string, unknown> = {}) => capability.execute({ 'app-id': 'app_a', ...args }, { lark: { request } } as unknown as CommandContext) };
}
it('projects file metadata and parses encoded uploader', async () => {
    const data = { file_name: 'a', path: '/a', size_bytes: 0, created_at: 'now', created_by: '{"id":"u","name":"User"}', hidden: true };
    expect(await fixture('get', data).run({ path: '/a' })).toEqual({ file_name: 'a', path: '/a', size_bytes: 0, uploaded_at: 'now', uploaded_by: { id: 'u', name: 'User' } });
    expect(await fixture('list', { items: [data], has_more: false }).run()).toMatchObject({ items: [{ file_name: 'a', uploaded_by: { id: 'u' } }], has_more: false });
});
it('normalizes relative and offset timestamps and positive size filters', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
    try {
        const f = fixture('list');
        await f.run({ 'uploaded-since': '2h', 'uploaded-until': '2026-10-09T20:00:00+08:00', 'size-gt': 0, 'size-lt': 100 });
        expect(f.request.mock.calls[0]![0].query).toEqual({ page_size: 20, uploaded_since: '2026-10-09T10:00:00Z', uploaded_until: '2026-10-09T12:00:00Z', size_lt: 100 });
    } finally { vi.useRealTimers(); }
});
it.each([{ 'page-size': 201 }, { 'uploaded-since': '2026-02-31' }, { 'app-id': 'meta' }])('rejects invalid file query %j', async (args) => {
    const f = fixture('list'); await expect(f.run(args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' }); expect(f.request).not.toHaveBeenCalled();
});
it('signs with default expiry and enforces ceiling', async () => {
    const f = fixture('sign', { signed_url: 'https://example.test/file' });
    expect(await f.run({ path: ' /a ' })).toHaveProperty('signed_url');
    expect(f.request.mock.calls[0]![0].body).toEqual({ path: '/a', expires_in: 86400 });
    await expect(f.run({ path: '/a', 'expires-in': 2592001 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
});
it('retains batch deletion results in input order', async () => {
    const f = fixture('delete', { results: [{ status: 'ok', file: { file_name: 'A' } }, { status: 'failed', error_code: 'FILE_NOT_FOUND' }] });
    await expect(f.run({ path: ['/a'] })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(await f.run({ path: [' /a ', '/b'], yes: true })).toEqual({ results: [{ status: 'ok', path: '/a', file_name: 'A' }, { status: 'failed', path: '/b', error: { code: 'FILE_NOT_FOUND', message: "File '/b' does not exist" } }] });
});
it('projects app file quota only', async () => {
    expect(await fixture('quota-get', { storage_used_bytes: 1, files: 2, storage_quota_bytes: 10, usage_percent: 10.02, tables: 5 }).run()).toEqual({ storage_used_bytes: 1, files: 2, storage_quota_bytes: 10, usage_percent: 10 });
});

import { describe, expect, it, vi } from 'vitest';
import { appsCapabilities } from '../src/capabilities/apps/commands';
import type { CommandContext } from '../src/ports/capabilities';

function fixture(id: string, response = {}) {
    const request = vi.fn().mockResolvedValue(response);
    const capability = appsCapabilities().find((item) => item.definition.id === `apps.+${id}`)!;
    const context = { lark: { request } } as unknown as CommandContext;
    return { capability, request, execute: (args: Record<string, any>) => capability.execute(args, context) };
}
describe('Apps core shortcuts', () => {
    it('projects app listings and preserves cursor filters', async () => {
        const f = fixture('list', { items: [{ app_id: 'a', icon_url: 'x', created_at: 1, name: 'App' }], has_more: true });
        expect(await f.execute({ keyword: ' App ', 'page-token': ' next ' })).toEqual({ items: [{ app_id: 'a', name: 'App' }], has_more: true });
        expect(f.request).toHaveBeenCalledWith({ method: 'GET', path: '/open-apis/spark/v1/apps', query: { page_size: 20, keyword: 'App', page_token: 'next' } });
    });
    it('creates and updates trimmed app fields', async () => {
        const f = fixture('create');
        await f.execute({ name: ' App ', 'app-type': 'html', description: ' Brief ', 'icon-url': ' https://example.test/icon ' });
        expect(f.request.mock.calls[0]![0].body).toEqual({ name: 'App', app_type: 'html', description: 'Brief', icon_url: 'https://example.test/icon' });
        const update = fixture('update');
        await expect(update.execute({ 'app-id': 'a', description: ' ' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(update.request).not.toHaveBeenCalled();
        await update.execute({ 'app-id': ' a/b ', name: ' N ' });
        expect(update.request).toHaveBeenCalledWith({ method: 'PATCH', path: '/open-apis/spark/v1/apps/a%2Fb', body: { name: 'N' } });
    });
    it('preserves cache values and normalizes metadata', async () => {
        const f = fixture('cache-get', { exists: 'TRUE', value: 'é', ttl_ms: '32.9', env: 'online' });
        expect(await f.execute({ 'app-id': 'a', key: 'key' })).toEqual({ key: 'key', environment: 'online', exists: true, value: 'é', value_size_bytes: 2, ttl_ms: 32 });
        expect(f.request.mock.calls[0]![0].query).toEqual({ key: 'key' });
        expect(await fixture('cache-get', { exists: false, value: 'hidden' }).execute({ 'app-id': 'a', key: 'x', environment: 'dev' })).toEqual({ key: 'x', environment: 'dev', exists: false, ttl_ms: null, value_size_bytes: null });
    });
    it('requires explicit cache clearing confirmation without blocking previews', async () => {
        const f = fixture('cache-clear', { deleted_key_count: '4' });
        await expect(f.execute({ 'app-id': 'a' })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
        await f.capability.preview({ 'app-id': 'a' });
        expect(f.request).not.toHaveBeenCalled();
        expect(await f.execute({ 'app-id': 'a', yes: true })).toEqual({ environment: '', deleted_key_count: 4 });
    });
    it('normalizes environment maps and arrays without leaking values', async () => {
        const f = fixture('env-list', { data: { envVars: { Z: 'secret', A: 'other' }, nextPageToken: 'n', hasMore: true } });
        expect(await f.execute({ 'app-id': 'a' })).toEqual({ items: [{ key: 'A' }, { key: 'Z' }], page_token: 'n', has_more: true });
        expect(f.request.mock.calls[0]![0].body).toEqual({ env: 'dev', scene: 2 });
        const array = fixture('env-list', { items: [{ key: 'A', value: 'secret', env: 'dev' }] });
        expect(await array.execute({ 'app-id': 'a' })).toMatchObject({ items: [{ key: 'A', env: 'dev' }] });
        expect(await array.execute({ 'app-id': 'a', 'include-values': true })).toMatchObject({ items: [{ key: 'A', value: 'secret', env: 'dev' }] });
    });
    it('redacts value previews and results and guards online mutation', async () => {
        const f = fixture('env-set', { value: 'secret' });
        const args = { 'app-id': 'a', key: ' FOO ', value: 'secret', environment: 'online' };
        expect(JSON.stringify(await f.capability.preview(args))).not.toContain('secret');
        await expect(f.execute(args)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
        expect(f.request).not.toHaveBeenCalled();
        expect(await f.execute({ ...args, yes: true })).toEqual({ key: 'FOO', env: 'online', action: 'set' });
        expect(f.request.mock.calls[0]![0].body).toEqual({ key: 'FOO', env: 'online', value: 'secret' });
    });
    it('deduplicates valid deletion keys and rejects invalid keys before IO', async () => {
        const f = fixture('env-delete');
        await expect(f.execute({ 'app-id': 'a', key: ['BAD-KEY'], yes: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
        expect(f.request).not.toHaveBeenCalled();
        expect(await f.execute({ 'app-id': 'a', key: [' FOO ', 'FOO', 'BAR'], yes: true })).toEqual({ env: 'dev', deleted_keys: ['FOO', 'BAR'] });
    });
});

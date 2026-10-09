import { expect, it, vi } from 'vitest';
import { appsPrograms } from '../src/capabilities/apps/programs';
const selection = { profileId: 'p', accountId: 'a', identity: 'user' }, grant = { id: 'g', revoked: false, expiresAt: Date.now() + 10000, profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], domains: ['apps', 'artifact'], permissions: ['read', 'write'] };
it('merges dotenv artifacts, preserves comments, and never returns values', async () => {
    let content = '';
    const artifacts = { stat: vi.fn().mockResolvedValue({ size: 32 }), read: vi.fn().mockResolvedValue(new Response('# comment\r\nexport A=old\r\nLOCAL=yes\r\n')), upload: vi.fn().mockImplementation(async (_owner, _size, stream) => { content = await new Response(stream).text(); return { id: 'out' }; }) };
    const request = vi.fn().mockResolvedValue({ env_vars: [{ key: 'B', value: 'line\nsecret' }, { key: 'A', value: 'new' }, { key: 'SUDA_DATABASE_URL', value: 'private', extras: [{ key: 'expiresAt', value: 123 }] }, { key: 'BAD KEY', value: 'bad' }] });
    const p = appsPrograms({ artifacts, remoteFiles: {} } as any).find((p) => p.id === 'apps-env-pull')!;
    expect(await p.step({ args: { 'app-id': 'a', file: 'input' } }, { selection, grant, lark: { request } } as any)).toEqual({ done: true, output: { app_id: 'a', env_file: 'out', artifactId: 'out', database_url_expires_at: '123' } });
    expect(content).toBe('# comment\nA="new"\nLOCAL=yes\nB="line\\nsecret"\nSUDA_DATABASE_URL="private"\n');
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/open-apis/spark/v1/apps/a/env_vars', body: { env: 'dev' } });
});
it('rejects malformed upstream environment shapes', async () => {
    const p = appsPrograms({ artifacts: {}, remoteFiles: {} } as any).find((p) => p.id === 'apps-env-pull')!;
    await expect(p.step({ args: { 'app-id': 'a' } }, { selection, grant, lark: { request: vi.fn().mockResolvedValue({}) } } as any)).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
});
it('rejects local project-path explicitly instead of ignoring it', async () => {
    const { appsCapabilities } = await import('../src/capabilities/apps/commands');
    const c = appsCapabilities().find((item) => item.definition.id === 'apps.+env-pull')!;
    await expect(c.preview({ 'app-id': 'a', 'project-path': '/local/project' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS', message: 'Use a file artifact instead of a local project-path.' });
});

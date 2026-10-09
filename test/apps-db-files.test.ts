import { expect, it, vi } from 'vitest';
import { appsPrograms } from '../src/capabilities/apps/programs';
const selection = { profileId: 'p', accountId: 'a', identity: 'user' as const };
const grant = { id: 'g', expiresAt: Date.now() + 600000, profiles: [{ profileId: 'p', identities: ['user'], accounts: ['a'] }], domains: ['apps', 'artifact'], permissions: ['read', 'write'] };
function fixture(content = 'x\n1\n') {
    const artifacts = { stat: vi.fn().mockResolvedValue({ size: content.length }), read: vi.fn().mockImplementation(() => Promise.resolve(new Response(content))), upload: vi.fn().mockResolvedValue({ id: 'out', size: content.length }) };
    const lark = { request: vi.fn().mockResolvedValue({ total: '8000' }), download: vi.fn().mockImplementation(() => Promise.resolve(new Response(content))), upload: vi.fn().mockResolvedValue({ rows: 2 }) };
    return { artifacts, lark, context: { selection, grant, lark } as any, program: (name: string) => appsPrograms({ artifacts, remoteFiles: {} } as any).find((p) => p.id === `apps-${name}`)! };
}
it('queries total then exports bounded bytes and caps reported rows', async () => {
    const f = fixture(), p = f.program('db-data-export');
    const first: any = await p.step({ phase: 'prepare', args: { 'app-id': 'a', table: 't', limit: 20 } }, f.context);
    expect(f.lark.request).toHaveBeenCalledWith({ method: 'GET', path: '/open-apis/spark/v1/apps/a/tables/t/records', query: { page_size: 1 } });
    expect(await p.step(first.state, f.context)).toEqual({ done: true, output: { table: 't', output: 'out', artifactId: 'out', format: 'csv', rows: 20, size_bytes: 4 } });
});
it('falls back to content row counts after total-query failure', async () => {
    const f = fixture('[{},{}]'), p = f.program('db-data-export'); f.lark.request.mockRejectedValueOnce(new Error());
    const first: any = await p.step({ phase: 'prepare', args: { 'app-id': 'a', table: 't', output: 't.json' } }, f.context);
    expect(await p.step(first.state, f.context)).toMatchObject({ output: { rows: 2, format: 'json' } });
});
it('imports an owned artifact with filename field and inferred table', async () => {
    const f = fixture(), p = f.program('db-data-import');
    expect(await p.step({ args: { 'app-id': 'a', file: 'input', name: 'orders.csv', environment: 'dev', yes: true } }, f.context)).toEqual({ done: true, output: { file: 'input', table: 'orders', rows: 2 } });
    expect(f.lark.upload).toHaveBeenCalledWith({ path: '/open-apis/spark/v1/apps/a/db/data_import', query: { env: 'dev', table: 'orders' }, fields: { file_name: 'orders.csv' }, file: { field: 'file', name: 'orders.csv', body: expect.any(Blob) } });
});
it('rejects excessive import size before reading and mutations without confirmation', async () => {
    const f = fixture(), p = f.program('db-data-import'), args = { 'app-id': 'a', file: 'input', name: 't.csv' };
    await expect(p.step({ args }, f.context)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    f.artifacts.stat.mockResolvedValueOnce({ size: 1048577 });
    await expect(p.step({ args: { ...args, yes: true } }, f.context)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(f.artifacts.read).not.toHaveBeenCalled(); expect(f.lark.upload).not.toHaveBeenCalled();
});
it('reads SQL artifacts privately and preserves source bytes', async () => {
    const f = fixture(' select 1; '), p = f.program('db-execute'); f.lark.request.mockResolvedValueOnce({ result: '[{"sql_type":"SELECT","data":"[]"}]' } as any);
    expect(await p.step({ args: { 'app-id': 'a', file: 'input', yes: true } }, f.context)).toEqual({ done: true, output: [] });
    expect(f.lark.request.mock.calls[0]![0].body).toEqual({ sql: ' select 1; ' });
});

import { expect, it, vi } from 'vitest';
import { appsCapabilities } from '../src/capabilities/apps/commands';
import type { CommandContext } from '../src/ports/capabilities';
function fixture(result: unknown) {
    const request = vi.fn().mockResolvedValue({ result: typeof result === 'string' ? result : JSON.stringify(result) });
    const c = appsCapabilities().find((c) => c.definition.id === 'apps.+db-execute')!;
    return { request, run: (args = {}) => c.execute({ 'app-id': 'a', sql: ' select 1; ', yes: true, ...args }, { lark: { request } } as unknown as CommandContext), preview: (args: any) => c.preview(args, {} as any) };
}
it('preserves SQL bytes and forces nontransactional execution', async () => {
    const f = fixture([{ sql_type: 'SELECT', data: '[{"a":1}]' }]);
    expect(await f.run({ environment: 'dev' })).toEqual([{ a: 1 }]);
    expect(f.request.mock.calls[0]![0]).toEqual({ method: 'POST', path: '/open-apis/spark/v1/apps/a/sql_commands', query: { transactional: false, env: 'dev' }, body: { sql: ' select 1; ' } });
});
it('normalizes legacy empty selects and multistatement DML', async () => {
    expect(await fixture(['[]', '']).run()).toEqual([{ command: 'SELECT', rows: [] }, { command: 'OK' }]);
    expect(await fixture([{ sql_type: 'UPDATE', affected_rows: '3' }, { sql_type: 'SELECT', data: 'invalid' }]).run()).toEqual([{ command: 'UPDATE', rows_affected: 3 }, { command: 'SELECT', rows: [] }]);
});
it('rejects ambiguous input and missing confirmation before requests', async () => {
    const f = fixture('');
    await expect(f.run({ file: 'artifact' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(f.run({ yes: false })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(f.request).not.toHaveBeenCalled();
    expect(await f.preview({ 'app-id': 'a', file: 'artifact' })).toMatchObject({ requests: [{ body: { sql: '<artifact contents>' } }] });
});
it('reports explicit transaction rollback and earlier committed statements', async () => {
    const error = { sql_type: 'ERROR', data: '{"code":"k_dl_1300002","message":"private SQL"}' };
    await expect(fixture([{ sql_type: 'BEGIN' }, error]).run()).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', details: { statement: 2, statements: 2, rolledBack: true, earlierCommitted: false, upstreamCode: 1300002 } });
    await expect(fixture([{ sql_type: 'UPDATE' }, error]).run()).rejects.toMatchObject({ details: { earlierCommitted: true, rolledBack: false } });
});
it('distinguishes whole-batch online DDL rejection', async () => {
    const f = fixture([{ sql_type: 'ERROR', data: '{"code":4000001}' }]);
    await expect(f.run()).rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { upstreamCode: 4000001, applied: false } });
});
